import { useCallback, useEffect, useRef, useState } from "react";
import type { Surface as SurfaceModel } from "../../lib/api";
import { Surface } from "../../tools/design/Surface";
import type { Theme } from "../../tools/design/kit";
import styles from "./Board.module.css";

// Board er den uendelige flaten dokumentet lever på: rutenettet ligger fast i
// verdensrommet, flatene ligger utover det, og brukeren drar seg rundt med
// musa. Ingen sider, ingen piler — man beveger seg dit man vil se.

// Verdenskoordinater: hver flate får fast bredde, og de legges i rader.
const CARD_W = 960;
const GAP = 80;
const PER_ROW = 3;

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;

interface View {
  x: number;
  y: number;
  z: number;
}

// ratioOf gir høyde/bredde-forholdet fra kittets format («16:9»).
function ratioOf(theme: Theme): number {
  const [w, h] = (theme.format?.ratio ?? "16:9").split(":").map(Number);
  return w && h ? h / w : 9 / 16;
}

export function Board({
  surfaces,
  theme,
  brand,
  edit,
  busy,
}: {
  surfaces: SurfaceModel[];
  theme: Theme;
  brand?: string;
  edit?: (id: string, field: string, value: string) => void;
  busy?: boolean;
}) {
  const [view, setView] = useState<View>({ x: 0, y: 0, z: 0.55 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const fitted = useRef(0);

  const cardH = CARD_W * ratioOf(theme);

  // Legg flatene i et rutenett i verdensrommet.
  const place = useCallback(
    (i: number) => ({
      x: (i % PER_ROW) * (CARD_W + GAP),
      y: Math.floor(i / PER_ROW) * (cardH + GAP),
    }),
    [cardH]
  );

  // Sentrer innholdet når det kommer nye flater (men bare når antallet endrer
  // seg — ellers ville lerretet hoppet mens brukeren jobber).
  useEffect(() => {
    if (surfaces.length === 0 || fitted.current === surfaces.length) return;
    fitted.current = surfaces.length;
    const el = wrapRef.current;
    if (!el) return;
    const rows = Math.ceil(surfaces.length / PER_ROW);
    const cols = Math.min(surfaces.length, PER_ROW);
    const w = cols * CARD_W + (cols - 1) * GAP;
    const h = rows * cardH + (rows - 1) * GAP;
    const z = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min((el.clientWidth - 120) / w, (el.clientHeight - 120) / h))
    );
    setView({
      z,
      x: (el.clientWidth - w * z) / 2,
      y: (el.clientHeight - h * z) / 2,
    });
  }, [surfaces.length, cardH]);

  // Dra i bakgrunnen for å flytte seg. Museknappen holdes nede — samme
  // bevegelse som i et tegneprogram.
  const onDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-surface]")) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }));
    };
    const up = () => (drag.current = null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  // Hjul: zoom mot pekeren med ctrl/⌘ (som i tegneprogrammer), ellers panorer.
  const onWheel = (e: React.WheelEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    if (e.ctrlKey || e.metaKey) {
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.z * Math.exp(-e.deltaY / 400)));
        const k = z / v.z;
        return { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
      });
      return;
    }
    setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };

  const grid = 40 * view.z;
  return (
    <div
      ref={wrapRef}
      className={`${styles.board} ${drag.current ? styles.grabbing : ""}`}
      onMouseDown={onDown}
      onWheel={onWheel}
      style={{
        backgroundSize: `${grid}px ${grid}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <div
        className={styles.world}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
      >
        {surfaces.map((s, i) => {
          const p = place(i);
          return (
            <div
              key={s.id}
              data-surface
              className={`${styles.card} ${busy ? styles.cardBusy : ""}`}
              style={{ left: p.x, top: p.y, width: CARD_W, height: cardH }}
            >
              <Surface
                s={s}
                theme={theme}
                brand={brand}
                edit={edit ? (field, value) => edit(s.id, field, value) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
