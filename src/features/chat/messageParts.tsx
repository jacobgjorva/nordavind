import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, FastWindIcon, SdCardIcon } from "@hugeicons/core-free-icons";
import { CodeBlock } from "./blocks/core";
import { renderBlock } from "./blocks/registry";
import type { SourceRef } from "../../lib/api";
import styles from "./Chat.module.css";

export function MarkdownPre({ children }: { children?: React.ReactNode }) {
  const el = children as
    | React.ReactElement<{ className?: string; children?: React.ReactNode }>
    | undefined;
  const code = el?.props;
  const lang = code?.className?.replace("language-", "");
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

// Under ord-animasjonen skal fenced-syntaks aldri vises rått: en ferdig
// ```copy-blokk vises som selve verdien (chipen tar over når markdown
// settles), og en ufullstendig fence holdes tilbake til den er hel.
function streamSafe(content: string): string {
  let s = content.replace(/```copy\n([^`]*?)\n?```/g, (_, v: string) => v.trim());
  const lastFence = s.lastIndexOf("```");
  if (lastFence >= 0) {
    const rest = s.slice(lastFence + 3);
    if (!rest.includes("```")) {
      const fences = s.match(/```/g)?.length ?? 0;
      if (fences % 2 === 1) s = s.slice(0, lastFence);
    }
  }
  return s;
}

export function StreamingText({
  content: rawContent,
  done,
  onDone,
}: {
  content: string;
  done: boolean;
  onDone?: () => void;
}) {
  const content = streamSafe(rawContent);
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

  // Ordene grupperes i avsnitt med samme luft som markdown-avsnittene, slik at
  // byttet til markdown når animasjonen er ferdig ikke flytter en eneste linje
  // (ren pre-wrap ga et sprett per avsnitt). Ordene beholder globale nøkler, så
  // fade-inn spiller kun for det som faktisk er nytt.
  const paras: { i: number; w: string }[][] = [[]];
  words.slice(0, visible).forEach((w, i) => {
    const brk = /\n[ \t]*\n/.test(w);
    paras[paras.length - 1].push({ i, w: brk ? w.replace(/\n[ \t]*\n\s*$/, "") : w });
    if (brk) paras.push([]);
  });

  return (
    <div className={styles.streamingText}>
      {paras.map((para, pi) => {
        if (para.length === 0) return null;
        // Et avsnitt der HVER linje starter med en kulepunkt-markør rendres som
        // ekte liste allerede under animasjonen — ellers ville punktene flyttet
        // seg 22 px sidelengs i det markdown tok over.
        const lines = toLines(para);
        const bullet = /^[-*+]\s/;
        const numbered = /^\d+[.)]\s/;
        const isList = lines.length > 0 && lines.every((l) => bullet.test(l[0].w));
        const isNumbered =
          !isList && lines.length > 0 && lines.every((l) => numbered.test(l[0].w));
        if (isList || isNumbered) {
          const List = isNumbered ? "ol" : "ul";
          return (
            <List key={pi} className={styles.streamingList}>
              {lines.map((line, li) => (
                <li key={li}>
                  {line.map(({ i, w }, wi) => {
                    let t = w;
                    // Markøren blir listens egen bullet, og linjeskiftet i
                    // halen ville gitt en tom linje inni punktet.
                    if (wi === 0) t = t.replace(isNumbered ? numbered : bullet, "");
                    if (wi === line.length - 1) t = t.replace(/\s+$/, "");
                    return <Word key={i} text={t} />;
                  })}
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={pi} className={styles.streamingPara}>
            {para.map(({ i, w }) => (
              <Word key={i} text={w} />
            ))}
          </p>
        );
      })}
    </div>
  );
}

// Ett ord i fade-inn-strømmen. Uthevede størrelser («**86 062 186 kr**») er
// bundet med hardt mellomrom og kommer derfor som ETT ord — de rendres som
// <strong> her, akkurat som markdown vil gjøre etterpå.
function Word({ text }: { text: string }) {
  const bold = text.match(/^(\*\*)([\s\S]+?)(\*\*)([^\w*]*)$/);
  // Inline-kode («`ordre-4412`») rendres som kode alt under animasjonen, så
  // byttet til markdown ikke endrer utseendet på nøkkelverdier.
  const code = text.match(/^`([^`]+)`([^\w`]*)$/);
  if (code) {
    return (
      <span className={styles.fadeSeg}>
        <code className={styles.inlineCode}>{code[1]}</code>
        {code[2]}
      </span>
    );
  }
  return (
    <span className={styles.fadeSeg}>
      {bold ? (
        <>
          <strong>{bold[2]}</strong>
          {bold[4]}
        </>
      ) : (
        text
      )}
    </span>
  );
}

// toLines deler et avsnitts ord i linjer — et ord bærer med seg sin egen
// etterfølgende whitespace, så linjeskiftet ligger i halen på siste ord.
function toLines(para: { i: number; w: string }[]) {
  const lines: { i: number; w: string }[][] = [[]];
  for (const t of para) {
    lines[lines.length - 1].push(t);
    if (/\n/.test(t.w)) lines.push([]);
  }
  return lines.filter((l) => l.length > 0);
}

// Handlingsrad under hvert assistentsvar: kopier, lagre til minne, korriger,
// kilder. Minnekortet lagrer meldingen som bedriftskunnskap med ett klikk —
// ingen spørsmål, brukeren bestemmer selv hva som er verdt å huske.
export function MessageActions({
  content,
  sources = [],
  armed = false,
  onArm,
  remembered = false,
  onRemember,
}: {
  content: string;
  sources?: SourceRef[];
  armed?: boolean;
  onArm?: (content: string) => void;
  remembered?: boolean;
  onRemember?: (content: string) => void;
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
      {onRemember && (
        <button
          className={`${styles.actionBtn} ${remembered ? styles.actionBtnActive : ""}`}
          onClick={() => !remembered && onRemember(content)}
          title={remembered ? "Lagret i minnet" : "Lagre til minnet"}
          aria-label="Lagre til minnet"
          aria-pressed={remembered}
        >
          <HugeiconsIcon icon={SdCardIcon} size={15} strokeWidth={2} />
        </button>
      )}
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
  // Svarets markerte setning kommer som en lenke til #mark — det er den eneste
  // markdown-syntaksen som bærer fet skrift og tall gjennom uendret.
  if (href === "#mark") {
    return <mark className={styles.keyMark}>{children}</mark>;
  }

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
