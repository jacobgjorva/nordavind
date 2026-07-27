import { memo, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { BoardItem } from "../../lib/api";
import { Surface } from "../../tools/design/Surface";
import { resolveTheme, type Kit, type Theme } from "../../tools/design/kit";
import styles from "./Board.module.css";

// Board er arbeidsområdet: en uendelig flate der dokumentene ligger side om
// side. Brukeren drar seg rundt, klikker et dokument for å jobbe med det, og
// skriver på tom flate for å lage et nytt.
//
// Ytelse: panorering og zoom skrives DIREKTE på DOM-en i en rAF-løkke, aldri
// gjennom React. Et setState per musebevegelse ville rendret hvert eneste
// dokument (med grafer og alt) på nytt og gjort bevegelsen hakkete.

export const DOC_W = 960;
const GRID = 40;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.5;

// Dokumenthøyden følger kittets format.
export function docHeight(theme: Theme): number {
  const [w, h] = (theme.format?.ratio ?? "16:9").split(":").map(Number);
  return DOC_W * (w && h ? h / w : 9 / 16);
}

export interface BoardHandle {
  /** Verdenskoordinaten midt i vinduet — der et nytt dokument havner. */
  center: () => { x: number; y: number };
  /** Flytt visningen så dokumentet står midt i vinduet. */
  focus: (slug: string) => void;
}

// DocFrame er memoisert: uten dette rendrer ETT flyttet dokument alle de
// andre på nytt — med grafer og tekst — og slippet føles tregt.
const DocFrame = memo(function DocFrame({
  item,
  theme,
  selected,
  busy,
  onEdit,
  onRename,
}: {
  item: BoardItem;
  theme: Theme;
  selected: boolean;
  busy: boolean;
  onEdit: (slug: string, surfaceId: string, field: string, value: string) => void;
  onRename: (slug: string, title: string) => void;
}) {
  const h = docHeight(theme);
  const surfaces = item.spec?.surfaces ?? [];
  return (
    <div
      data-slug={item.slug}
      className={`${styles.doc} ${selected ? styles.docSelected : ""} ${
        busy ? styles.docBusy : ""
      }`}
      style={{ left: item.x, top: item.y, width: DOC_W }}
    >
      {/* Navnetaggen er også håndtaket: hold og dra her for å flytte rammen,
          dobbeltklikk for å døpe den om. */}
      <div
        data-drag
        className={styles.tag}
        onDoubleClick={(ev) => {
          const el = ev.currentTarget;
          el.contentEditable = "true";
          el.focus();
          document.getSelection()?.selectAllChildren(el);
        }}
        onBlur={(ev) => {
          const el = ev.currentTarget;
          el.contentEditable = "false";
          const name = (el.textContent ?? "").trim();
          if (name && name !== item.title) onRename(item.slug, name);
          else el.textContent = item.title;
        }}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            ev.currentTarget.blur();
          }
          if (ev.key === "Escape") {
            ev.currentTarget.textContent = item.title;
            ev.currentTarget.blur();
          }
        }}
        suppressContentEditableWarning
      >
        {item.title}
      </div>
      {surfaces.length === 0 ? (
        <div className={styles.docEmpty} style={{ height: h }}>
          Tomt
        </div>
      ) : (
        surfaces.map((s) => (
          <div key={s.id} className={styles.surface} style={{ height: h }}>
            <Surface
              s={s}
              theme={theme}
              brand={item.spec?.title}
              edit={
                selected
                  ? (field, value) => onEdit(item.slug, s.id, field, value)
                  : undefined
              }
            />
          </div>
        ))
      )}
    </div>
  );
});

export function Board({
  ref,
  items,
  kits,
  selected,
  onSelect,
  onMove,
  onEdit,
  onRename,
  busySlug,
}: {
  ref?: React.Ref<BoardHandle>;
  items: BoardItem[];
  kits: Record<string, Kit> | null;
  selected: string | null;
  onSelect: (slug: string | null) => void;
  onMove: (slug: string, pos: { x: number; y: number }) => void;
  onEdit: (slug: string, surfaceId: string, field: string, value: string) => void;
  onRename: (slug: string, title: string) => void;
  busySlug?: string | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const view = useRef({ x: 0, y: 0, z: 0.55 });
  const frame = useRef(0);
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const dragDoc = useRef<{
    slug: string;
    el: HTMLElement;
    x: number;
    y: number;
    ox: number;
    oy: number;
    dx: number;
    dy: number;
    moved: boolean;
    frame: number;
  } | null>(null);
  const anim = useRef(0);

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

  useEffect(() => {
    paint();
    return () => {
      cancelAnimationFrame(frame.current);
      cancelAnimationFrame(anim.current);
    };
  }, [paint]);

  // Myk forflytning til et mål — brukes når et dokument velges og skal
  // snappe inn i midten.
  const glideTo = useCallback(
    (tx: number, ty: number, tz: number) => {
      cancelAnimationFrame(anim.current);
      const from = { ...view.current };
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / 320);
        // easeOutCubic: rask start, mykt anslag.
        const e = 1 - Math.pow(1 - p, 3);
        view.current = {
          x: from.x + (tx - from.x) * e,
          y: from.y + (ty - from.y) * e,
          z: from.z + (tz - from.z) * e,
        };
        paint();
        if (p < 1) anim.current = requestAnimationFrame(step);
      };
      anim.current = requestAnimationFrame(step);
    },
    [paint]
  );

  const themeOf = useCallback(
    (it: BoardItem): Theme =>
      resolveTheme(kits ?? {}, it.spec?.kit, it.spec?.style),
    [kits]
  );

  const focusDoc = useCallback(
    (slug: string) => {
      const el = wrapRef.current;
      const it = items.find((i) => i.slug === slug);
      if (!el || !it) return;
      const h = docHeight(themeOf(it));
      const z = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, Math.min((el.clientWidth - 160) / DOC_W, (el.clientHeight - 160) / h))
      );
      glideTo(
        el.clientWidth / 2 - (it.x + DOC_W / 2) * z,
        el.clientHeight / 2 - (it.y + h / 2) * z,
        z
      );
    },
    [items, themeOf, glideTo]
  );

  useImperativeHandle(
    ref,
    () => ({
      center: () => {
        const el = wrapRef.current;
        const { x, y, z } = view.current;
        if (!el) return { x: 0, y: 0 };
        // Nytt dokument sentreres der brukeren ser, ikke i verdens origo.
        return {
          x: (el.clientWidth / 2 - x) / z - DOC_W / 2,
          y: (el.clientHeight / 2 - y) / z - (DOC_W * 0.5625) / 2,
        };
      },
      focus: focusDoc,
    }),
    [focusDoc]
  );

  // Klikk på tom flate: ingenting er valgt, og neste melding lager et nytt
  // dokument. Klikk på et dokument velger det; FLYTTING skjer kun via
  // navnetaggen over rammen, så man aldri drar dokumentet ut av stilling
  // mens man jobber i det.
  const onPointerDown = (e: React.PointerEvent) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>("[data-slug]");
    if (card) {
      const slug = card.dataset.slug!;
      const it = items.find((i) => i.slug === slug);
      if (!it) return;
      if (!(e.target as HTMLElement).closest("[data-drag]")) {
        onSelect(slug);
        return;
      }
      dragDoc.current = {
        slug,
        el: card,
        x: e.clientX,
        y: e.clientY,
        ox: it.x,
        oy: it.y,
        dx: 0,
        dy: 0,
        moved: false,
        frame: 0,
      };
      // Løft rammen ut i eget lag mens den flyttes: da flyttes ferdig malte
      // piksler av GPU-en i stedet for at hele dokumentet males på nytt.
      card.style.willChange = "transform";
      wrapRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    onSelect(null);
    pan.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y };
    wrapRef.current?.setPointerCapture(e.pointerId);
    wrapRef.current?.classList.add(styles.grabbing);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragDoc.current;
    if (d) {
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      d.moved = true;
      d.dx = (e.clientX - d.x) / view.current.z;
      d.dy = (e.clientY - d.y) / view.current.z;
      // Transform, ikke left/top: left/top utløser layout for hele rammen
      // (med grafer og tekst) hver eneste frame — transform gjør ikke det.
      if (!d.frame) {
        d.frame = requestAnimationFrame(() => {
          d.frame = 0;
          d.el.style.transform = `translate3d(${d.dx}px, ${d.dy}px, 0)`;
        });
      }
      return;
    }
    const p = pan.current;
    if (!p) return;
    view.current.x = p.vx + (e.clientX - p.x);
    view.current.y = p.vy + (e.clientY - p.y);
    schedule();
  };

  const endPointer = (e: React.PointerEvent) => {
    const d = dragDoc.current;
    if (d) {
      dragDoc.current = null;
      cancelAnimationFrame(d.frame);
      d.el.style.willChange = "";
      d.el.style.transform = "";
      wrapRef.current?.releasePointerCapture(e.pointerId);
      if (d.moved) {
        // Ny posisjon settes én gang, når musa slippes.
        d.el.style.left = `${d.ox + d.dx}px`;
        d.el.style.top = `${d.oy + d.dy}px`;
        onMove(d.slug, { x: d.ox + d.dx, y: d.oy + d.dy });
      } else {
        onSelect(d.slug);
        focusDoc(d.slug);
      }
      return;
    }
    if (!pan.current) return;
    pan.current = null;
    wrapRef.current?.releasePointerCapture(e.pointerId);
    wrapRef.current?.classList.remove(styles.grabbing);
  };

  // Hjul: zoom mot pekeren med ctrl/⌘ (styreflatens knipebevegelse sendes som
  // ctrl+wheel), ellers panorering.
  const onWheel = useCallback(
    (e: WheelEvent) => {
      const el = wrapRef.current;
      if (!el) return;
      e.preventDefault();
      cancelAnimationFrame(anim.current);
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

  // Wheel må være ikke-passiv for at preventDefault skal virke (React setter
  // passive som standard, og siden ville zoomet i stedet).
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
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      <div ref={worldRef} className={styles.world}>
        {items.map((it) => (
          <DocFrame
            key={it.slug}
            item={it}
            theme={themeOf(it)}
            selected={selected === it.slug}
            busy={busySlug === it.slug}
            onEdit={onEdit}
            onRename={onRename}
          />
        ))}
      </div>
    </div>
  );
}
