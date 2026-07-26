// Flyt-visningen: agentens kompilerte plan som en horisontal node-graf.
// Planen ER JSON-en agenten kjører — det som endres her, endrer hva agenten
// faktisk gjør. Serveren prøvekjører hvert steg før lagring, så en ødelagt
// spørring kan ikke lagres.
import { useCallback, useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ChartLineData01Icon,
  Database01Icon,
  FilterIcon,
  Globe02Icon,
  Mail01Icon,
  Message01Icon,
  PlayCircleIcon,
  Search01Icon,
  StopCircleIcon,
} from "@hugeicons/core-free-icons";
import {
  fetchAgentPlan,
  rebuildAgentPlan,
  saveAgentPlan,
  setAgentSchedule,
  type AgentPlan,
  type PlanStep,
} from "../../lib/api";
import { ApiError } from "../../lib/api/client";
import { AVATAR_COLORS } from "../../ui/avatar";
import styles from "./AgentFlow.module.css";

// Frekvensene Start-noden tilbyr. Minimum er 15 min, som i backend.
const INTERVALS: { s: number; label: string }[] = [
  { s: 900, label: "Hvert 15. minutt" },
  { s: 1800, label: "Hver halvtime" },
  { s: 3600, label: "Hver time" },
  { s: 10800, label: "Hver 3. time" },
  { s: 21600, label: "Hver 6. time" },
  { s: 43200, label: "To ganger daglig" },
  { s: 86400, label: "Daglig" },
  { s: 604800, label: "Ukentlig" },
];

const KIND_LABEL: Record<string, string> = {
  sql: "Database",
  web: "Nettsøk",
  fetch: "Hent side",
};

// Nodegeometri — layouten regnes ut i kode så kurvene kan tegnes i SVG.
const NODE_W = 196;
const GAP_X = 68;
const ROW_H = 30; // høyde på en utgang-rad («Funn» / «Ingen funn»)
const PAD = 40;
const WIRE_GAP = 9; // luft mellom node og forbindelseslinje

// editorHeight: plassen redigeringen tar inne i noden når den er åpen.
// Layouten er beregnet, så høyden må være kjent på forhånd.
function editorHeight(node: { key: string; kind?: string }): number {
  if (node.key.startsWith("step-")) return node.kind === "sql" ? 268 : 160;
  if (node.key === "judge") return 236;
  if (node.key === "mail") return 196;
  if (node.key === "chart") return 262;
  if (node.key === "start") return 132;
  return 0;
}

type Tone = "start" | "step" | "judge" | "act" | "end";

// Fargene kommer fra den delte paletten (mail-avatar, filopplasting) —
// [bakgrunn, ikonfarge], så flyten snakker samme visuelle språk som resten.
const TONE_COLOR: Record<Tone, [string, string]> = {
  start: AVATAR_COLORS[2], // grønn
  step: AVATAR_COLORS[0], // blå
  judge: AVATAR_COLORS[4], // gul
  act: AVATAR_COLORS[6], // lilla
  end: AVATAR_COLORS[5], // rosa
};

interface FlowNode {
  key: string;
  title: string;
  sub?: string;
  tone: Tone;
  icon: typeof PlayCircleIcon;
  kind?: string; // stegtype, styrer hvilke felt som redigeres
  rows?: string[]; // utganger tegnet som rader i noden
  x: number;
  y: number;
  h: number;
  editable?: boolean;
}

export default function AgentFlow({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [meta, setMeta] = useState<{ status: string; schedule?: string; name?: string }>({
    status: "",
  });
  // Frekvens (Start-noden) — lagres direkte, ikke via plan-lagringen.
  const [interval, setIntervalSec] = useState(86400);
  const [runTime, setRunTime] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(() => {
    fetchAgentPlan(agentId)
      .then((res) => {
        setPlan(res.plan);
        setMeta({ status: res.status, schedule: res.schedule_label, name: res.agent_name });
        setIntervalSec(res.interval_seconds ?? 86400);
        setRunTime(res.run_time ?? "");
      })
      .catch(() => setPlan(null));
  }, [agentId]);

  useEffect(load, [load]);

  useEffect(() => {
    if (meta.status !== "building") return;
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [meta.status, load]);

  const patch = (next: Partial<AgentPlan>) => {
    setPlan((p) => (p ? { ...p, ...next } : p));
    setDirty(true);
    setProblems([]);
  };

  const patchStep = (i: number, next: Partial<PlanStep>) => {
    setPlan((p) =>
      p ? { ...p, steps: p.steps.map((s, j) => (j === i ? { ...s, ...next } : s)) } : p
    );
    setDirty(true);
    setProblems([]);
  };

  const save = async () => {
    if (!plan) return;
    setSaving(true);
    setProblems([]);
    try {
      const saved = await saveAgentPlan(agentId, plan);
      setPlan(saved);
      setDirty(false);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "";
      let listed: string[] | null = null;
      try {
        const parsed = JSON.parse(msg) as { problems?: string[] };
        if (parsed.problems?.length) listed = parsed.problems;
      } catch {
        /* ikke JSON — vis rå melding */
      }
      setProblems(listed ?? [msg || "Kunne ikke lagre."]);
    } finally {
      setSaving(false);
    }
  };

  // Frekvensen lagres med en gang — den er agent-config, ikke del av planen.
  const saveSchedule = async (secs: number, time: string) => {
    const label = INTERVALS.find((i) => i.s === secs)?.label ?? "";
    setIntervalSec(secs);
    setRunTime(time);
    setMeta((m) => ({ ...m, schedule: label }));
    await setAgentSchedule(agentId, {
      interval_seconds: secs,
      run_time: time,
      schedule_label: label + (secs >= 86400 && time ? ` kl ${time}` : ""),
    }).catch(() => setProblems(["Kunne ikke lagre frekvensen."]));
  };

  const rebuild = async () => {
    await rebuildAgentPlan(agentId).catch(() => {});
    setMeta((m) => ({ ...m, status: "building" }));
    setPlan(null);
    load();
  };

  // Layout: Start → steg → vurdering (to utganger) → handling / slutt.
  const { nodes, edges, width, height } = useMemo(() => {
    const nodes: FlowNode[] = [];
    const edges: { from: string; to: string; port?: number }[] = [];
    if (!plan) return { nodes, edges, width: 0, height: 0 };

    const midY = PAD + 90;
    let col = 0;
    const colX = (c: number) => PAD + c * (NODE_W + GAP_X);

    nodes.push({
      key: "start",
      title: "Start",
      sub: INTERVALS.find((i) => i.s === interval)?.label ?? "fast frekvens",
      tone: "start",
      icon: PlayCircleIcon,
      x: colX(col++),
      y: midY,
      h: 56 + (selected === "start" ? editorHeight({ key: "start" }) : 0),
      editable: true,
    });

    plan.steps.forEach((s, i) => {
      nodes.push({
        key: `step-${i}`,
        title: s.label || `Steg ${i + 1}`,
        sub: KIND_LABEL[s.kind] ?? s.kind,
        tone: "step",
        icon:
          s.kind === "sql" ? Database01Icon : s.kind === "web" ? Search01Icon : Globe02Icon,
        kind: s.kind,
        x: colX(col++),
        y: midY,
        h: 70 + (selected === `step-${i}` ? editorHeight({ key: `step-${i}`, kind: s.kind }) : 0),
        editable: true,
      });
      edges.push({ from: i === 0 ? "start" : `step-${i - 1}`, to: `step-${i}` });
    });

    const judgeX = colX(col++);
    const judgeRows = ["Funn", "Ingen funn"];
    const judgeH =
      58 + judgeRows.length * ROW_H + 10 + (selected === "judge" ? editorHeight({ key: "judge" }) : 0);
    nodes.push({
      key: "judge",
      title: "Vurder resultatet",
      sub: "regel",
      tone: "judge",
      icon: FilterIcon,
      rows: judgeRows,
      x: judgeX,
      y: midY - 20,
      h: judgeH,
      editable: true,
    });
    edges.push({
      from: plan.steps.length ? `step-${plan.steps.length - 1}` : "start",
      to: "judge",
    });

    // Funn-grenen: varsel, e-post og graf ligger over hverandre i siste kolonne.
    const lastX = colX(col);
    let branchY = midY - 60;
    const actIcon: Record<string, typeof PlayCircleIcon> = {
      notify: Message01Icon,
      mail: Mail01Icon,
      chart: ChartLineData01Icon,
    };
    const act = (key: string, title: string, sub?: string, editable?: boolean) => {
      nodes.push({
        key,
        title,
        sub,
        tone: "act",
        icon: actIcon[key] ?? Message01Icon,
        x: lastX,
        y: branchY,
        h: (sub ? 56 : 46) + (selected === key ? editorHeight({ key }) : 0),
        editable,
      });
      edges.push({ from: "judge", to: key, port: 0 });
      branchY += (sub ? 56 : 46) + 14 + (selected === key ? editorHeight({ key }) : 0);
    };
    act("notify", "Varsel i chatten", "melding");
    if (plan.mail) act("mail", "Send e-post", plan.mail.to_email, true);
    if (plan.chart) act("chart", "Vis graf", plan.chart.title, true);

    nodes.push({
      key: "end",
      title: "Stille",
      tone: "end",
      icon: StopCircleIcon,
      x: lastX,
      y: branchY + 10,
      h: 46,
    });
    edges.push({ from: "judge", to: "end", port: 1 });

    const width = lastX + NODE_W + PAD;
    const minY = Math.min(...nodes.map((n) => n.y));
    if (minY < PAD) for (const n of nodes) n.y += PAD - minY;
    const height = Math.max(...nodes.map((n) => n.y + n.h)) + PAD;
    return { nodes, edges, width, height };
  }, [plan, selected, interval]);

  if (!plan || (!plan.steps?.length && meta.status !== "ready")) {
    return (
      <div className={styles.flow}>
        <div className={styles.topBar}>
          <span className={styles.title}>Flyt</span>
          <button className={styles.close} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className={styles.placeholder}>
          {meta.status === "building"
            ? "Agenten finner ut hvordan oppgaven løses best …"
            : meta.status === "broken"
              ? "Planen virker ikke. Bygg den på nytt."
              : "Ingen plan ennå."}
          {meta.status !== "building" && (
            <button className={styles.ghost} onClick={rebuild}>
              Bygg plan
            </button>
          )}
        </div>
      </div>
    );
  }

  const byKey = new Map(nodes.map((n) => [n.key, n]));
  // Kurvet forbindelse mellom to noder; port peker på en utgang-rad.
  const path = (e: { from: string; to: string; port?: number }) => {
    const a = byKey.get(e.from)!;
    const b = byKey.get(e.to)!;
    const ax = a.x + NODE_W + WIRE_GAP;
    const ay =
      e.port !== undefined && a.rows
        ? a.y + 58 + e.port * ROW_H + ROW_H / 2
        : a.y + a.h / 2;
    const bx = b.x - WIRE_GAP;
    const by = b.y + b.h / 2;
    const dx = Math.max(30, (bx - ax) / 2);
    return `M ${ax} ${ay} C ${ax + dx} ${ay}, ${bx - dx} ${by}, ${bx} ${by}`;
  };

  // nodeEditor: feltene som vises inne i noden når den er åpen.
  const nodeEditor = (n: FlowNode) => {
    if (n.key.startsWith("step-")) {
      const i = Number(n.key.slice(5));
      const s = plan.steps[i];
      if (!s) return null;
      return (
        <>
          <label className={styles.field}>
            Navn
            <input value={s.label} onChange={(e) => patchStep(i, { label: e.target.value })} />
          </label>
          {s.kind === "sql" && (
            <label className={styles.field}>
              Spørring
              <textarea
                rows={7}
                value={s.sql ?? ""}
                onChange={(e) => patchStep(i, { sql: e.target.value })}
              />
            </label>
          )}
          {s.kind === "web" && (
            <label className={styles.field}>
              Søk
              <input
                value={s.query ?? ""}
                onChange={(e) => patchStep(i, { query: e.target.value })}
              />
            </label>
          )}
          {s.kind === "fetch" && (
            <label className={styles.field}>
              URL
              <input
                value={s.url ?? ""}
                onChange={(e) => patchStep(i, { url: e.target.value })}
              />
            </label>
          )}
          <button
            className={styles.remove}
            onClick={() => {
              patch({ steps: plan.steps.filter((_, j) => j !== i) });
              setSelected(null);
            }}
          >
            Fjern steget
          </button>
        </>
      );
    }
    if (n.key === "start") {
      return (
        <>
          <label className={styles.field}>
            Kjører
            <select
              value={interval}
              onChange={(e) => saveSchedule(Number(e.target.value), runTime)}
            >
              {INTERVALS.map((i) => (
                <option key={i.s} value={i.s}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
          {interval >= 86400 && (
            <label className={styles.field}>
              Klokkeslett
              <input
                type="time"
                value={runTime}
                onChange={(e) => saveSchedule(interval, e.target.value)}
              />
            </label>
          )}
        </>
      );
    }
    if (n.key === "judge") {
      return (
        <>
          <label className={styles.field}>
            Dette følges med på
            <textarea
              rows={3}
              value={plan.watch}
              onChange={(e) => patch({ watch: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            Si fra når
            <textarea
              rows={3}
              value={plan.alert_rule}
              onChange={(e) => patch({ alert_rule: e.target.value })}
            />
          </label>
        </>
      );
    }
    if (n.key === "mail" && plan.mail) {
      return (
        <>
          <label className={styles.field}>
            Mottaker
            <input
              value={plan.mail.to_email}
              onChange={(e) => patch({ mail: { ...plan.mail!, to_email: e.target.value } })}
            />
          </label>
          <label className={styles.field}>
            Emne
            <input
              value={plan.mail.subject}
              onChange={(e) => patch({ mail: { ...plan.mail!, subject: e.target.value } })}
            />
          </label>
          <button
            className={styles.remove}
            onClick={() => {
              patch({ mail: null });
              setSelected(null);
            }}
          >
            Slutt å sende e-post
          </button>
        </>
      );
    }
    if (n.key === "chart" && plan.chart) {
      return (
        <>
          <label className={styles.field}>
            Tittel
            <input
              value={plan.chart.title}
              onChange={(e) => patch({ chart: { ...plan.chart!, title: e.target.value } })}
            />
          </label>
          <label className={styles.field}>
            Spørring
            <textarea
              rows={6}
              value={plan.chart.sql}
              onChange={(e) => patch({ chart: { ...plan.chart!, sql: e.target.value } })}
            />
          </label>
          <button
            className={styles.remove}
            onClick={() => {
              patch({ chart: null });
              setSelected(null);
            }}
          >
            Fjern grafen
          </button>
        </>
      );
    }
    return null;
  };

  return (
    <div className={styles.flow}>
      <div className={styles.topBar}>
        <span className={styles.title}>{meta.name ?? "Flyt"}</span>
        <span className={styles.sub}>{meta.schedule}</span>
        <div className={styles.actions}>
          {dirty && (
            <button className={styles.save} onClick={save} disabled={saving}>
              {saving ? "Prøvekjører …" : "Lagre"}
            </button>
          )}
          <button className={styles.ghost} onClick={rebuild}>
            Bygg på nytt
          </button>
          <button className={styles.close} onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      {problems.length > 0 && (
        <div className={styles.problems}>
          {problems.map((p, i) => (
            <div key={i}>{p}</div>
          ))}
        </div>
      )}

      <div className={styles.canvas}>
        <div className={styles.stageWrap}>
          <div className={styles.stage} style={{ width, height }}>
          <svg className={styles.wires} width={width} height={height}>
            {edges.map((e, i) => (
              <path key={i} d={path(e)} fill="none" stroke="#34353b" strokeWidth={1.5} />
            ))}
          </svg>

          {nodes.map((n) => (
            <div
              key={n.key}
              className={`${styles.node} ${styles[n.tone]} ${
                selected === n.key ? styles.nodeSelected : ""
              } ${n.editable ? styles.nodeEditable : ""}`}
              style={{ left: n.x, top: n.y, width: NODE_W }}
              onClick={() => n.editable && setSelected(selected === n.key ? null : n.key)}
            >
              <div className={styles.nodeHead}>
                <span
                  className={styles.icon}
                  style={{
                    background: TONE_COLOR[n.tone][0],
                    color: TONE_COLOR[n.tone][1],
                  }}
                >
                  <HugeiconsIcon icon={n.icon} size={13} strokeWidth={2} />
                </span>
                <span className={styles.nodeText}>
                  <span className={styles.nodeTitle}>{n.title}</span>
                  {n.sub && <span className={styles.nodeSub}>{n.sub}</span>}
                </span>
              </div>
              {n.rows?.map((r) => (
                <div key={r} className={styles.row}>
                  {r}
                </div>
              ))}
              {selected === n.key && (
                <div className={styles.editor} onClick={(e) => e.stopPropagation()}>
                  {nodeEditor(n)}
                </div>
              )}
            </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
