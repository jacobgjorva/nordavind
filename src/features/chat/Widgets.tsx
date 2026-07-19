import { useEffect, useState, type ReactNode } from "react";
import { CopyIcon } from "../../ui/Icons";
import {
  createAgent,
  fetchAgentConnections,
  updateAgent,
  type AgentConnection,
  type AgentInfo as AgentRecord,
} from "../../lib/api";
import { WidgetView } from "./WidgetView";
import styles from "./Widgets.module.css";

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
export function CopyValue({ value, hint }: { value: string; hint?: string }) {
  return (
    <span className={styles.valueChip}>
      <span className={styles.valueText}>{value}</span>
      {hint && <span className={styles.valueHint}>{hint}</span>}
      <CopyButton value={value} label="" />
    </span>
  );
}

// Nøkkeltall-kort for enkeltverdier.
export function StatCard({
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
export function DataTable({
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
export function ActionBar({ actions }: { actions: WidgetAction[] }) {
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

export interface WidgetAction {
  type: "mailto" | "download" | "copy";
  label: string;
  value: string;
  filename?: string;
}

// Rendrer en spesial-fenced kodeblokk (```stat / ```table / ```copy / ```actions)
// til riktig widget. Ukjent språk -> vanlig kodeblokk med kopier.
interface AgentInfo {
  id?: string;
  name: string;
  task?: string;
  schedule_label?: string;
  daily_token_limit?: number;
  write_access?: boolean;
  enabled?: boolean;
}

// Agent-widget: kort per agent når brukeren ber om å se dem.
export function AgentList({ agents }: { agents: AgentInfo[] }) {
  if (agents.length === 0) {
    return <div className={styles.agentEmpty}>Ingen agenter ennå.</div>;
  }
  return (
    <div className={styles.agentList}>
      {agents.map((a, i) => (
        <div key={a.id ?? i} className={styles.agentCard}>
          <div className={styles.agentHead}>
            <span className={styles.agentName}>{a.name}</span>
            <span
              className={`${styles.agentBadge} ${
                a.write_access ? styles.agentBadgeWrite : ""
              }`}
            >
              {a.write_access ? "Skriv" : "Les"}
            </span>
          </div>
          {a.task && <div className={styles.agentTask}>{a.task}</div>}
          <div className={styles.agentMeta}>
            {a.schedule_label && <span>{a.schedule_label}</span>}
            {a.daily_token_limit ? (
              <span>{a.daily_token_limit.toLocaleString("nb-NO")} tokens/dag</span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// Fleksibelt intervall: antall × enhet dekker alle tilfeller
// (hver time, annenhver dag, hver 3. uke …).
const UNITS: { label: string; seconds: number }[] = [
  { label: "minutt", seconds: 60 },
  { label: "time", seconds: 3600 },
  { label: "dag", seconds: 86400 },
  { label: "uke", seconds: 604800 },
];

// Bryt sekunder ned til {antall, enhet} med den største enheten som går opp.
function decomposeInterval(sec: number): { count: number; unitSec: number } {
  for (let i = UNITS.length - 1; i >= 0; i--) {
    const u = UNITS[i].seconds;
    if (sec >= u && sec % u === 0) return { count: sec / u, unitSec: u };
  }
  return { count: 1, unitSec: 86400 };
}

// Klokkeslett er kun meningsfullt når intervallet er minst én dag.
const showsTime = (unitSec: number) => unitSec >= 86400;

// Innsats: hvor mye agenten får bruke per kjøring, uttrykt som token-tak.
const EFFORTS: { label: string; tokens: number }[] = [
  { label: "Lav", tokens: 10000 },
  { label: "Moderat", tokens: 50000 },
  { label: "Høy", tokens: 150000 },
  { label: "Max", tokens: 500000 },
];

// Felt modellen kan be widgeten vise. Bare relevante felt tas med — en
// websøk-agent trenger f.eks. verken tilkobling eller skrivetilgang.
interface AgentField {
  type: string;
  value?: unknown;
}

// Normaliser innsats-verdien modellen sender (indeks, nivånavn eller token-tall).
function toEffortIndex(v: unknown): number {
  if (typeof v === "number") {
    if (v >= 0 && v < EFFORTS.length) return v;
    const byTokens = EFFORTS.findIndex((e) => e.tokens >= v);
    return byTokens === -1 ? EFFORTS.length - 1 : byTokens;
  }
  if (typeof v === "string") {
    const i = EFFORTS.findIndex(
      (e) => e.label.toLowerCase() === v.toLowerCase()
    );
    if (i !== -1) return i;
  }
  return 1;
}

// Start-widget: enkelt kort med agentnavn + Aktiver-knapp. Alle innstillinger
// er allerede samlet inn av AI-en; brukeren bare bekrefter oppstart.
export function AgentSetup({
  name,
  task,
  fields,
}: {
  name?: string;
  task: string;
  fields?: AgentField[];
}) {
  const spec = fields?.length ? fields : [{ type: "interval" }, { type: "effort" }];
  const has = (t: string) => spec.some((f) => f.type === t);
  const initial = (t: string) => spec.find((f) => f.type === t)?.value;

  const [connId, setConnId] = useState<string>((initial("connection") as string) || "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!has("connection") || connId) return;
    // Knytt eneste tilkobling automatisk hvis modellen ikke ga en gyldig id.
    fetchAgentConnections()
      .then((c) => {
        setConnId((cur) =>
          c.some((x) => x.id === cur) ? cur : c.length === 1 ? c[0].id : cur
        );
      })
      .catch(() => {});
  }, []);

  const intervalSec = Math.max(900, Number(initial("interval")) || 86400);
  const runTime = (initial("time") as string) || "";
  const effort = toEffortIndex(initial("effort"));
  const dec = decomposeInterval(intervalSec);
  const unitLabel = UNITS.find((u) => u.seconds === dec.unitSec)?.label ?? "dag";
  const intervalLabel =
    dec.count === 1 ? `Hver ${unitLabel}` : `Hver ${dec.count}. ${unitLabel}`;

  const agentName = name?.trim() || "Agent";

  async function activate() {
    if (busy || done) return;
    setBusy(true);
    setError(null);
    try {
      await createAgent({
        name: agentName,
        task: task.trim(),
        connection_id: has("connection") ? connId : "",
        schedule_label:
          has("time") && runTime ? `${intervalLabel} kl ${runTime}` : intervalLabel,
        interval_seconds: intervalSec,
        run_time: has("time") ? runTime : "",
        daily_token_limit: EFFORTS[effort].tokens,
        write_access: Boolean(initial("write")),
      });
      setDone(true);
      window.dispatchEvent(new CustomEvent("nordavind:agents-changed"));
    } catch {
      setError("Kunne ikke aktivere agenten.");
    } finally {
      setBusy(false);
    }
  }

  // Når agenten er aktivert forsvinner widgeten helt.
  if (done) return null;

  return (
    <div className={styles.startCard}>
      <span className={styles.startName}>{agentName}</span>
      {error && <span className={styles.startError}>{error}</span>}
      <button
        type="button"
        className={styles.startBtn}
        onClick={activate}
        disabled={busy}
      >
        {busy ? "…" : "Aktiver"}
      </button>
    </div>
  );
}

// Rediger en eksisterende agent direkte i agent-chatten.
export function AgentEditor({
  agent,
  onSaved,
}: {
  agent: AgentRecord;
  onSaved?: () => void;
}) {
  const initInterval = decomposeInterval(agent.interval_seconds || 86400);
  const [conns, setConns] = useState<AgentConnection[]>([]);
  const [name, setName] = useState(agent.name);
  const [taskText, setTaskText] = useState(agent.task ?? "");
  const [time, setTime] = useState(agent.run_time || "12:00");
  const [count, setCount] = useState(initInterval.count);
  const [unitSec, setUnitSec] = useState(initInterval.unitSec);
  const [effort, setEffort] = useState(
    toEffortIndex(agent.daily_token_limit ?? 50000)
  );
  const [write, setWrite] = useState(Boolean(agent.write_access));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasConn = Boolean(agent.connection_id);
  const [connId, setConnId] = useState(agent.connection_id ?? "");

  useEffect(() => {
    if (!hasConn) return;
    fetchAgentConnections().then(setConns).catch(() => {});
  }, [hasConn]);

  const unitLabel = UNITS.find((u) => u.seconds === unitSec)?.label ?? "dag";
  const intervalLabel =
    count === 1 ? `Hver ${unitLabel}` : `Hver ${count}. ${unitLabel}`;
  const intervalSec = count * unitSec;

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateAgent(agent.id, {
        name: name.trim() || "Agent",
        task: taskText.trim(),
        connection_id: hasConn ? connId : "",
        schedule_label: showsTime(unitSec)
          ? `${intervalLabel} kl ${time}`
          : intervalLabel,
        interval_seconds: Math.max(900, intervalSec),
        run_time: showsTime(unitSec) ? time : "",
        daily_token_limit: EFFORTS[effort].tokens,
        write_access: write,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      window.dispatchEvent(new CustomEvent("nordavind:agents-changed"));
      onSaved?.();
    } catch {
      setError("Kunne ikke lagre.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.agentSetup}>
      <div className={styles.setupHead}>
        <input
          className={styles.editName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Agentnavn"
        />
      </div>
      <div className={styles.setupPanel}>
        <div className={styles.setupField}>
          <div className={styles.setupLabel}>Mission</div>
          <textarea
            className={styles.setupMissionBox}
            value={taskText}
            rows={2}
            onChange={(e) => setTaskText(e.target.value)}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }}
          />
        </div>

        <div className={styles.setupField}>
          <div className={styles.setupLabel}>Innstillinger</div>
          <div className={styles.setupRows}>
            {hasConn && (
              <label className={styles.row}>
                <span className={styles.rowLabel}>Tilkobling</span>
                <div className={styles.rowSelectWrap}>
                  <select
                    className={styles.rowSelect}
                    value={connId}
                    onChange={(e) => setConnId(e.target.value)}
                  >
                    {conns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span className={styles.rowChevron}>⌄</span>
                </div>
              </label>
            )}

            <div className={styles.row}>
              <span className={styles.rowLabel}>Intervall</span>
              <div className={styles.rowIntervalCtl}>
                <span className={styles.rowMuted}>Hver</span>
                <input
                  type="number"
                  min={1}
                  className={styles.rowNum}
                  value={count}
                  onChange={(e) =>
                    setCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                  }
                />
                <div className={styles.rowSelectWrap}>
                  <select
                    className={styles.rowSelect}
                    value={unitSec}
                    onChange={(e) => setUnitSec(Number(e.target.value))}
                  >
                    {UNITS.map((u) => (
                      <option key={u.seconds} value={u.seconds}>
                        {u.label}
                        {count > 1 ? "er" : ""}
                      </option>
                    ))}
                  </select>
                  <span className={styles.rowChevron}>⌄</span>
                </div>
              </div>
            </div>

            {showsTime(unitSec) && (
              <label className={styles.row}>
                <span className={styles.rowLabel}>Klokkeslett</span>
                <input
                  type="time"
                  className={styles.rowTime}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </label>
            )}

            <div className={`${styles.row} ${styles.rowSlider}`}>
              <span
                className={styles.rowFill}
                style={{ width: `${(effort / (EFFORTS.length - 1)) * 100}%` }}
              />
              <span className={styles.rowLabel}>Innsats</span>
              <input
                type="range"
                className={styles.rowRange}
                min={0}
                max={EFFORTS.length - 1}
                step={1}
                value={effort}
                onChange={(e) => setEffort(Number(e.target.value))}
              />
              <span className={styles.rowValue}>{EFFORTS[effort].label}</span>
            </div>

            {hasConn && (
              <div className={styles.row}>
                <span className={styles.rowLabel}>Skrivetilgang</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={write}
                  className={`${styles.toggle} ${write ? styles.toggleOn : ""}`}
                  onClick={() => setWrite((v) => !v)}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className={styles.editFoot}>
          {error && <span className={styles.setupError}>{error}</span>}
          <button
            type="button"
            className={styles.editSave}
            onClick={save}
            disabled={busy}
          >
            {busy ? "Lagrer …" : saved ? "Lagret ✓" : "Lagre endringer"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function renderFenced(lang: string, body: string): ReactNode {
  try {
    if (lang === "widget") {
      const slug = body.trim().split(/\s+/)[0].replace(/^\//, "");
      if (slug) return <WidgetView slug={slug} />;
    }
    if (lang === "copy") {
      const [value, hint] = body.split("\n");
      return <CopyValue value={value.trim()} hint={hint?.trim()} />;
    }
    if (lang === "stat") return <StatCard {...JSON.parse(body)} />;
    if (lang === "table") {
      const d = JSON.parse(body);
      return <DataTable columns={d.columns} rows={d.rows} />;
    }
    if (lang === "actions") return <ActionBar actions={JSON.parse(body)} />;
    if (lang === "agents") {
      const d = JSON.parse(body);
      const agents: AgentInfo[] = Array.isArray(d) ? d : d.agents ?? [];
      return <AgentList agents={agents} />;
    }
    if (lang === "agent_setup") {
      const d = JSON.parse(body);
      return <AgentSetup name={d.name} task={d.task ?? ""} fields={d.fields} />;
    }
  } catch {
    // fall through til vanlig kodeblokk
  }
  return null;
}
