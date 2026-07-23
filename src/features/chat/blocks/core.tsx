import { useState, type ReactNode } from "react";
import { CopyIcon } from "../../../ui/Icons";
import { registerBlock } from "./registry";
import styles from "./blocks.module.css";

// Rekursivt ut med ren tekst fra react-markdown-noder (til kopiering).
function textOf(node: ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(value);
    setDone(true);
    setTimeout(() => setDone(false), 1400);
  }
  return (
    <button className={styles.copyBtn} onClick={copy} title="Kopier">
      <CopyIcon size={13} />
      {done ? "Kopiert" : label ?? "Kopier"}
    </button>
  );
}

// Kun-ikon kopier-knapp (til kodeblokk-header).
function CopyIconBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(value);
    setDone(true);
    setTimeout(() => setDone(false), 1400);
  }
  return (
    <button
      className={`${styles.copyIcon} ${done ? styles.copyIconDone : ""}`}
      onClick={copy}
      title={done ? "Kopiert" : "Kopier"}
      aria-label="Kopier"
    >
      <CopyIcon size={14} />
    </button>
  );
}

const CODE_KEYWORDS = new Set(
  ("const let var function return if else for while export import from default " +
    "class extends new await async try catch throw typeof instanceof of in " +
    "select from where join left right inner outer on group order by limit as and or not null " +
    "def print import as with lambda True False None elif " +
    "public private static void int string bool func type interface struct package").split(" ")
);

// Lett syntaks-highlighter: kommentarer, strenger, tall, nøkkelord, egenskaper.
function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    if (m[1]) out.push(<span key={key++} className={styles.tComment}>{m[1]}</span>);
    else if (m[2]) out.push(<span key={key++} className={styles.tString}>{m[2]}</span>);
    else if (m[3]) out.push(<span key={key++} className={styles.tNumber}>{m[3]}</span>);
    else if (m[4]) {
      const cls = CODE_KEYWORDS.has(m[4].toLowerCase())
        ? styles.tKeyword
        : code[re.lastIndex] === "(" ? styles.tFunc : undefined;
      out.push(cls ? <span key={key++} className={cls}>{m[4]}</span> : m[4]);
    }
    last = re.lastIndex;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

const LANG_LABEL: Record<string, string> = {
  sql: "SQL",
  py: "Python",
  python: "Python",
  js: "JavaScript",
  ts: "TypeScript",
  tsx: "TypeScript",
  json: "JSON",
  bash: "Bash",
  sh: "Shell",
  go: "Go",
  html: "HTML",
  css: "CSS",
};

function langLabel(lang?: string): string {
  if (!lang) return "Tekst";
  return LANG_LABEL[lang.toLowerCase()] ?? lang.charAt(0).toUpperCase() + lang.slice(1);
}

// Kodeblokk med språk-etikett, syntaksfarging og kopier-ikon.
export function CodeBlock({ children, lang }: { children?: ReactNode; lang?: string }) {
  const raw = textOf(children);
  return (
    <div className={styles.codeWrap}>
      <div className={styles.codeBar}>
        <span className={styles.codeLang}>{langLabel(lang)}</span>
        <CopyIconBtn value={raw} />
      </div>
      <pre className={styles.code}>
        <code>{highlight(raw)}</code>
      </pre>
    </div>
  );
}

// Enkeltverdi (e-post, tlf, IBAN, ordrenr) med tydelig kopier-plass.
function CopyValue({ value, hint }: { value: string; hint?: string }) {
  return (
    <span className={styles.valueChip}>
      <span className={styles.valueText}>{value}</span>
      {hint && <span className={styles.valueHint}>{hint}</span>}
      <CopyButton value={value} label="" />
    </span>
  );
}

// Nøkkeltall-kort for enkeltverdier.
function StatCard({
  label,
  value,
  unit,
  delta,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
}) {
  const up = delta?.startsWith("+");
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>
        {value}
        {unit && <span className={styles.statUnit}>{unit}</span>}
      </div>
      {delta && (
        <div className={`${styles.statDelta} ${up ? styles.deltaUp : styles.deltaDown}`}>
          {delta}
        </div>
      )}
    </div>
  );
}

// Tabell for rader (fra databasen), med kopier-hele.
function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: string[][];
}) {
  const tsv = [columns.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");
  return (
    <div className={styles.tableWrap}>
      <div className={styles.tableBar}>
        <span className={styles.tableMeta}>{rows.length} rader</span>
        <CopyButton value={tsv} label="Kopier tabell" />
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Handlingsrad: send e-post, eksporter CSV, last ned tekst.
function ActionBar({ actions }: { actions: WidgetAction[] }) {
  function run(a: WidgetAction) {
    if (a.type === "mailto") {
      window.location.href = `mailto:${a.value}`;
    } else if (a.type === "download") {
      const blob = new Blob([a.value], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const el = document.createElement("a");
      el.href = url;
      el.download = a.filename ?? "nordavind.txt";
      el.click();
      URL.revokeObjectURL(url);
    } else if (a.type === "copy") {
      navigator.clipboard?.writeText(a.value);
    }
  }
  return (
    <div className={styles.actionBar}>
      {actions.map((a, i) => (
        <button key={i} className={styles.actionBtn} onClick={() => run(a)}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

interface WidgetAction {
  type: "mailto" | "download" | "copy";
  label: string;
  value: string;
  filename?: string;
}

// Rendrer en spesial-fenced kodeblokk (```stat / ```table / ```copy / ```actions)
// til riktig widget. Ukjent språk -> vanlig kodeblokk med kopier.


// Registrer kjerne-blokkene.
registerBlock("copy", (body) => {
  const [value, hint] = body.split("\n");
  return <CopyValue value={value.trim()} hint={hint?.trim()} />;
});
registerBlock("stat", (body) => <StatCard {...JSON.parse(body)} />);
registerBlock("table", (body) => {
  const d = JSON.parse(body);
  return <DataTable columns={d.columns} rows={d.rows} />;
});
registerBlock("actions", (body) => <ActionBar actions={JSON.parse(body)} />);
