import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DeckSlide, WidgetSpec } from "../../lib/api";
import {
  layoutOf,
  resolveImage,
  themeVars,
  type DeckTheme,
  type KitBlock,
} from "./kit";
import styles from "./Slide.module.css";
import { Duo, KitKpi, KitTable, ThemeCtx, Visual } from "./visuals";

// Slide rendrer én slide ut fra kittets komposisjon: hver blokk i layouten
// peker på et felt, og feltet fylles av modellen eller av brukeren selv.
// Rendereren kjenner ingen layout-navn — kommer det en ny slide-type i
// kit-JSON-en, virker den her uten kodeendring.

type Editor = (field: string, value: string) => void;

function Md({ text }: { text?: string }) {
  if (!text) return null;
  return <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>;
}

// Tekst som brukeren kan dobbeltklikke og skrive om. Rå tekst redigeres (også
// for markdown-felter), og lagres ved blur eller Escape.
function Editable({
  value,
  className,
  onSave,
  children,
}: {
  value: string;
  className?: string;
  onSave?: (value: string) => void;
  /** Visningen når feltet ikke redigeres (markdown, sitat, liste …) */
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  if (!onSave) return <div className={className}>{children}</div>;
  if (!editing)
    return (
      <div
        className={`${className ?? ""} ${styles.editable}`}
        onDoubleClick={() => setEditing(true)}
        title="Dobbeltklikk for å endre"
      >
        {children}
      </div>
    );
  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };
  return (
    <div className={`${className ?? ""} ${styles.editing}`}>
      <textarea
        ref={ref}
        className={styles.editArea}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
          // Enter lagrer i énlinjefelt; Shift+Enter gir ny linje.
          if (e.key === "Enter" && !e.shiftKey && !value.includes("\n")) {
            e.preventDefault();
            commit();
          }
        }}
      />
    </div>
  );
}

// Én blokk fra kit-konfigurasjonen.
function Block({
  b,
  s,
  theme,
  brand,
  edit,
}: {
  b: KitBlock;
  s: DeckSlide;
  theme: DeckTheme;
  brand?: string;
  edit?: Editor;
}) {
  const cls = b.class ? styles[b.class] : undefined;
  // Ny slide-type i kit-JSON-en med en klasse som mangler i temaets CSS er
  // den ene feilen denne rendereren ikke kan se selv — si fra i utvikling.
  if (import.meta.env.DEV && b.class && !cls)
    console.warn(`deck: klassen «${b.class}» finnes ikke i temaets CSS`);
  const field = b.field ?? "";
  const raw = field ? (s as Record<string, unknown>)[field] : undefined;
  const text = typeof raw === "string" ? raw : "";
  const onSave = edit ? (v: string) => edit(field, v) : undefined;

  switch (b.kind) {
    case "group":
      return (
        <div className={cls}>
          {(b.children ?? []).map((c, i) => (
            <Block key={i} b={c} s={s} theme={theme} brand={brand} edit={edit} />
          ))}
        </div>
      );

    case "bg": {
      const src = resolveImage(theme, text);
      if (!src) return null;
      return (
        <>
          <img src={src} className={styles.bgImg} alt="" />
          <div className={styles.bgShade} />
        </>
      );
    }

    case "brand":
      return brand ? <div className={cls}>{brand}</div> : null;

    case "text": {
      const shown = text || b.fallback || "";
      if (!shown && !edit) return null;
      return (
        <Editable value={text} className={cls} onSave={onSave}>
          {(b.prefix ?? "") + shown}
        </Editable>
      );
    }

    case "md":
      if (!text && !edit) return null;
      return (
        <Editable value={text} className={cls} onSave={onSave}>
          <Md text={text} />
        </Editable>
      );

    case "quote": {
      const clean = text.replace(/^["“«]+|["”»]+$/g, "");
      if (!clean && !edit) return null;
      return (
        <Editable value={text} className={cls} onSave={onSave}>
          <Md text={`“${clean}”`} />
        </Editable>
      );
    }

    case "toc": {
      const items = text
        .split("\n")
        .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
        .filter(Boolean);
      if (items.length === 0 && !edit) return null;
      return (
        <Editable value={text} className={cls} onSave={onSave}>
          {items.map((item, i) => (
            <div key={i} className={styles.tocItem}>
              <span className={styles.tocNum}>{String(i + 1).padStart(2, "0")}</span>
              <span>{item}</span>
            </div>
          ))}
        </Editable>
      );
    }

    case "image": {
      const src = resolveImage(theme, text);
      return src ? <img src={src} className={cls} alt="" /> : null;
    }

    case "imageAt": {
      const list = Array.isArray(raw) ? (raw as string[]) : [];
      const src = resolveImage(theme, list[b.index ?? 0]);
      return src ? <img src={src} className={cls} alt="" /> : null;
    }

    case "chart": {
      const spec = raw as WidgetSpec | undefined;
      if (!spec) return null;
      return (
        <div className={cls}>
          <Visual spec={spec} />
        </div>
      );
    }

    case "chartDuo":
      return <Duo widgets={(raw as WidgetSpec[]) ?? []} />;

    case "kpis":
      return (
        <div className={cls}>
          {((raw as WidgetSpec[]) ?? []).slice(0, 4).map((wgt, i) => (
            <KitKpi key={i} spec={wgt} />
          ))}
        </div>
      );

    case "table": {
      const spec = raw as WidgetSpec | undefined;
      return spec ? <KitTable spec={spec} /> : null;
    }

    default:
      return null;
  }
}

// Slide: fast 16:9-flate. Typografien skalerer med containeren (cqw), så
// samme komponent brukes i canvas, miniatyr og fullskjerm.
export function Slide({
  s,
  theme,
  brand,
  edit,
}: {
  s: DeckSlide;
  theme: DeckTheme;
  brand?: string;
  /** Satt: brukeren kan dobbeltklikke og skrive om tekstfeltene. */
  edit?: Editor;
}) {
  const layout = layoutOf(theme, s.layout);
  return (
    <ThemeCtx.Provider value={theme}>
      <div className={styles.slide} style={themeVars(theme)}>
        {(layout?.blocks ?? []).map((b, i) => (
          <Block key={i} b={b} s={s} theme={theme} brand={brand} edit={edit} />
        ))}
      </div>
    </ThemeCtx.Provider>
  );
}
