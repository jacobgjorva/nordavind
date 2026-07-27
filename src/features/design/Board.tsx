import { useCallback, useEffect, useRef } from "react";
import type { Surface as SurfaceModel } from "../../lib/api";
import { Surface } from "../../tools/design/Surface";
import type { Theme } from "../../tools/design/kit";
import styles from "./Board.module.css";

// Board er den uendelige flaten dokumentet lever på: rutenettet ligger fast i
// verdensrommet, flatene ligger utover det, og brukeren drar seg rundt med
// musa.
//
// Ytelse: panorering og zoom skrives DIREKTE på DOM-en i en rAF-løkke, aldri
// gjennom React. Et setState per musebevegelse ville rendret hver eneste
// flate (med grafer og alt) på nytt og gjort bevegelsen hakkete — her flyttes
// bare to style-verdier per frame.

const CARD_W = 960;
const GAP = 80;
const PER_ROW = 3;
const GRID = 40;

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;

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
  const wrapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const view = useRef({ x: 0, y: 0, z: 0.55 });
  const frame = useRef(0);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const fitted = useRef(0);

  const cardH = CARD_W * ratioOf(theme);

  // Én skriving per frame: transform på verdenen, bakgrunnsposisjon på
  // rutenettet. Ingenting annet røres.
  const paint = useCallback(() => {
    frame.current = 0;
    const { x, y, z } = view.current;
    if (worldRef.current)
      worldRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${z})`;
    if (wrapRef.current) {
      const g = GRID * z;
      wrapRef.current.style.backgroundSize = `${g}px ${g}px`;
      wrapRef.current.style.backgroundPosition = `${x}px ${y}px`;
    }
  }, []);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Sentrer innholdet når det kommer nye flater — aldri mens brukeren jobber.
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
    view.current = {
      z,
      x: (el.clientWidth - w * z) / 2,
      y: (el.clientHeight - h * z) / 2,
    };
    schedule();
  }, [surfaces.length, cardH, schedule]);

  useEffect(() => {
    paint();
  }, [paint]);

  // Dra i bakgrunnen for å flytte seg. Pekeren fanges, så bevegelsen fortsetter
  // selv når musa forlater vinduet.
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-surface]")) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      vx: view.current.x,
      vy: view.current.y,
    };
    wrapRef.current?.setPointerCapture(e.pointerId);
    wrapRef.current?.classList.add(styles.grabbing);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    view.current.x = d.vx + (e.clientX - d.x);
    view.current.y = d.vy + (e.clientY - d.y);
    schedule();
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    wrapRef.current?.releasePointerCapture(e.pointerId);
    wrapRef.current?.classList.remove(styles.grabbing);
  };

  // Hjul: zoom mot pekeren med ctrl/⌘ (og med styreflatens knipebevegelse,
  // som nettleseren sender som ctrl+wheel), ellers panorering.
  const onWheel = useCallback(
    (e: WheelEvent) => {
      const el = wrapRef.current;
      if (!el) return;
      e.preventDefault();
      const v = view.current;
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.z * Math.exp(-e.deltaY / 400)));
        const k = z / v.z;
        view.current = { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
      } else {
        view.current = { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
      }
      schedule();
    },
    [schedule]
  );

  // Wheel må være en ikke-passiv lytter for at preventDefault skal virke
  // (React setter passive som standard, og siden ville zoomet i stedet).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  return (
    <div
      ref={wrapRef}
      className={styles.board}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div ref={worldRef} className={styles.world}>
        {surfaces.map((s, i) => (
          <div
            key={s.id}
            data-surface
            className={`${styles.card} ${busy ? styles.cardBusy : ""}`}
            style={{
              left: (i % PER_ROW) * (CARD_W + GAP),
              top: Math.floor(i / PER_ROW) * (cardH + GAP),
              width: CARD_W,
              height: cardH,
            }}
          >
            <Surface
              s={s}
              theme={theme}
              brand={brand}
              edit={edit ? (field, value) => edit(s.id, field, value) : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
