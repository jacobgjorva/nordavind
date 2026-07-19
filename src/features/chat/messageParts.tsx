import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, FastWindIcon } from "@hugeicons/core-free-icons";
import { CodeBlock } from "./blocks/core";
import { renderBlock } from "./blocks/registry";
import type { SourceRef } from "../../lib/api";
import styles from "./Chat.module.css";

export function MarkdownPre({ children }: { children?: React.ReactNode }) {
  const code = (children as any)?.props;
  const lang = (code?.className as string | undefined)?.replace("language-", "");
  const body =
    typeof code?.children === "string"
      ? code.children
      : Array.isArray(code?.children)
        ? code.children.join("")
        : "";
  if (lang) {
    const widget = renderBlock(lang, body.replace(/\n$/, ""));
    if (widget) return <>{widget}</>;
  }
  return <CodeBlock lang={lang}>{children}</CodeBlock>;
}

export function StreamingText({
  content,
  done,
  onDone,
}: {
  content: string;
  done: boolean;
  onDone?: () => void;
}) {
  const [visible, setVisible] = useState(0);

  // Under streaming committes kun frem til siste ordgrense; når svaret er
  // ferdig committes alt, så animasjonen alltid spiller helt ut.
  const boundary = Math.max(content.lastIndexOf(" "), content.lastIndexOf("\n"));
  const committed = done
    ? content
    : boundary >= 0
      ? content.slice(0, boundary + 1)
      : "";
  const words = committed.match(/\S+\s*|\s+/g) ?? [];

  useEffect(() => {
    if (visible >= words.length) {
      if (done) onDone?.();
      return;
    }
    // Jevn takt; øker steget hvis vi ligger langt bak streamen, men alltid
    // minst ett ord av gangen så raske svar også animerer synlig.
    const backlog = words.length - visible;
    const t = setTimeout(
      () =>
        setVisible((v) =>
          Math.min(v + Math.max(1, Math.ceil(backlog / 25)), words.length)
        ),
      38
    );
    return () => clearTimeout(t);
  }, [visible, words.length, done]);

  return (
    <span className={styles.streamingText}>
      {words.slice(0, visible).map((w, i) => (
        <span key={i} className={styles.fadeSeg}>
          {w}
        </span>
      ))}
    </span>
  );
}

// Handlingsrad under hvert assistentsvar: kopier, korriger, kilder.
export function MessageActions({
  content,
  sources = [],
  armed = false,
  onArm,
}: {
  content: string;
  sources?: SourceRef[];
  armed?: boolean;
  onArm?: (content: string) => void;
}) {
  const [open, setOpen] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(content);
  }

  return (
    <div className={styles.actions}>
      <button className={styles.actionBtn} onClick={copy} title="Kopier" aria-label="Kopier">
        <HugeiconsIcon icon={Copy01Icon} size={15} strokeWidth={2} />
      </button>
      <button
        className={`${styles.actionBtn} ${armed ? styles.actionBtnActive : ""}`}
        onClick={() => onArm?.(content)}
        title={armed ? "Neste melding logges som korrigering" : "Korriger dette svaret"}
        aria-label="Korriger svar"
        aria-pressed={armed}
      >
        <HugeiconsIcon icon={FastWindIcon} size={15} strokeWidth={2} />
      </button>
      {sources.length > 0 && (
        <>
          <button className={styles.sourcesBtn} onClick={() => setOpen((o) => !o)}>
            <span className={styles.sourcesCount}>{sources.length}</span>
            Kilder
          </button>
          {open && (
            <div className={styles.sourcesList}>
              {sources.map((s) => (
                <SourceLink key={s.url} href={s.url}>
                  {s.title || s.url}
                </SourceLink>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Kildelenker rendres som små tags med favicon + sidenavn i stedet for URL.
export function SourceLink({
  href,
  children,
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  let host = "";
  try {
    host = href ? new URL(href).hostname.replace(/^www\./, "") : "";
  } catch {
    host = "";
  }

  const text = Array.isArray(children) ? children.join("") : String(children ?? "");

  // Numeriske referanselenker ([1] med definisjon nederst) rendres som
  // hevet kildehenvisning i Perplexity-stil.
  if (/^\d{1,2}$/.test(text.trim())) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={styles.citation}>
        {text.trim()}
      </a>
    );
  }

  let label: React.ReactNode = children;
  if (host && (text === href || text.startsWith("http"))) {
    const name = host.split(".")[0];
    label = name.charAt(0).toUpperCase() + name.slice(1);
  }

  return (
    <a href={href} target="_blank" rel="noreferrer" className={styles.sourceTag}>
      {label}
      <span className={styles.sourceArrow}>↗</span>
    </a>
  );
}

// Komprimerer resonneringsstrømmen til 1-3 ord: siste **uthevede** frase,
// ellers de første ordene i siste linje.
export function thinkingLabel(reasoning?: string): string {
  if (!reasoning?.trim()) return "Tenker";
  const bolds = reasoning.match(/\*\*([^*]{2,60})\*\*/g);
  let raw = bolds ? bolds[bolds.length - 1].replace(/\*/g, "") : "";
  if (!raw) {
    const lines = reasoning.trim().split("\n").filter(Boolean);
    raw = lines[lines.length - 1] ?? "";
  }
  const words = raw
    .replace(/[#*:.\d()]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
  return words || "Tenker";
}
