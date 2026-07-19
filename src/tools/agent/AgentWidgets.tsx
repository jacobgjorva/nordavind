import { useEffect, useState } from "react";
import { createAgent, fetchAgentConnections } from "../../lib/api";
import type { AgentInfo as ApiAgentInfo } from "../../lib/api";
import { registerBlock } from "../../features/chat/blocks/registry";
import styles from "./AgentWidgets.module.css";

// Widget-varianten: samme domenetype som API-et, men alle felt valgfrie
// bortsett fra navnet (agentene kan komme fra et delvis parset block).
type AgentInfo = Partial<ApiAgentInfo> & { name: string };

// Agent-widget: kort per agent når brukeren ber om å se dem.
function AgentList({ agents }: { agents: AgentInfo[] }) {
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
function AgentSetup({
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

// Registrer agent-blokkene.
registerBlock("agents", (body) => {
  const d = JSON.parse(body);
  const agents: AgentInfo[] = Array.isArray(d) ? d : d.agents ?? [];
  return <AgentList agents={agents} />;
});
registerBlock("agent_setup", (body) => {
  const d = JSON.parse(body);
  return <AgentSetup name={d.name} task={d.task ?? ""} fields={d.fields} />;
});
