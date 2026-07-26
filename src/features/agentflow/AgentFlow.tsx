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
  type AgentPlan,
  type PlanStep,
} from "../../lib/api";
import { ApiError } from "../../lib/api/client";
import styles from "./AgentFlow.module.css";

const KIND_LABEL: Record<string, string> = {
  sql: "Database",
  web: "Nettsøk",
  fetch: "Hent side",
};

// Nodegeometri — layouten regnes ut i kode så kurvene kan tegnes i SVG.
const NODE_W = 210;
const GAP_X = 72;
const ROW_H = 34; // høyde på en utgang-rad («Funn» / «Ingen funn»)
const PAD = 40;

type Tone = "start" | "step" | "judge" | "act" | "end";

interface FlowNode {
  key: string;
  title: string;
  sub?: string;
  tone: Tone;
  icon: typeof PlayCircleIcon;
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
  const [selected, setSelected] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(() => {
    fetchAgentPlan(agentId)
      .then((res) => {
        setPlan(res.plan);
        setMeta({ status: res.status, schedule: res.schedule_label, name: res.agent_name });
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
      tone: "start",
      icon: PlayCircleIcon,
      x: colX(col++),
      y: midY,
      h: 52,
    });

    plan.steps.forEach((s, i) => {
      nodes.push({
        key: `step-${i}`,
        title: s.label || `Steg ${i + 1}`,
        sub: KIND_LABEL[s.kind] ?? s.kind,
        tone: "step",
        icon:
          s.kind === "sql" ? Database01Icon : s.kind === "web" ? Search01Icon : Globe02Icon,
        x: colX(col++),
        y: midY,
        h: 62,
        editable: true,
      });
      edges.push({ from: i === 0 ? "start" : `step-${i - 1}`, to: `step-${i}` });
    });

    const judgeX = colX(col++);
    const judgeRows = ["Funn", "Ingen funn"];
    const judgeH = 62 + judgeRows.length * ROW_H + 10;
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
        h: sub ? 62 : 52,
        editable,
      });
      edges.push({ from: "judge", to: key, port: 0 });
      branchY += 78;
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
      y: branchY + 12,
      h: 52,
    });
    edges.push({ from: "judge", to: "end", port: 1 });

    const width = lastX + NODE_W + PAD;
    const height = Math.max(...nodes.map((n) => n.y + n.h)) + PAD;
    return { nodes, edges, width, height };
  }, [plan]);

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
    const ax = a.x + NODE_W;
    const ay =
      e.port !== undefined && a.rows
        ? a.y + 62 + e.port * ROW_H + ROW_H / 2
        : a.y + a.h / 2;
    const bx = b.x;
    const by = b.y + b.h / 2;
    const dx = Math.max(30, (bx - ax) / 2);
    return `M ${ax} ${ay} C ${ax + dx} ${ay}, ${bx - dx} ${by}, ${bx} ${by}`;
  };

  const sel = selected ? byKey.get(selected) : null;
  const stepIndex = sel?.key.startsWith("step-") ? Number(sel.key.slice(5)) : -1;

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
                <span className={`${styles.icon} ${styles[`icon_${n.tone}`]}`}>
                  <HugeiconsIcon icon={n.icon} size={15} strokeWidth={2} />
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
            </div>
            ))}
          </div>
        </div>
      </div>

      {/* Redigeringspanelet for valgt node. */}
      {sel && (
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            {sel.title}
            <button className={styles.close} onClick={() => setSelected(null)}>
              ✕
            </button>
          </div>

          {stepIndex >= 0 && plan.steps[stepIndex] && (
            <>
              <label className={styles.field}>
                Navn
                <input
                  value={plan.steps[stepIndex].label}
                  onChange={(e) => patchStep(stepIndex, { label: e.target.value })}
                />
              </label>
              {plan.steps[stepIndex].kind === "sql" && (
                <label className={styles.field}>
                  Spørring
                  <textarea
                    rows={7}
                    value={plan.steps[stepIndex].sql ?? ""}
                    onChange={(e) => patchStep(stepIndex, { sql: e.target.value })}
                  />
                </label>
              )}
              {plan.steps[stepIndex].kind === "web" && (
                <label className={styles.field}>
                  Søk
                  <input
                    value={plan.steps[stepIndex].query ?? ""}
                    onChange={(e) => patchStep(stepIndex, { query: e.target.value })}
                  />
                </label>
              )}
              {plan.steps[stepIndex].kind === "fetch" && (
                <label className={styles.field}>
                  URL
                  <input
                    value={plan.steps[stepIndex].url ?? ""}
                    onChange={(e) => patchStep(stepIndex, { url: e.target.value })}
                  />
                </label>
              )}
              <button
                className={styles.remove}
                onClick={() => {
                  patch({ steps: plan.steps.filter((_, j) => j !== stepIndex) });
                  setSelected(null);
                }}
              >
                Fjern steget
              </button>
            </>
          )}

          {sel.key === "judge" && (
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
          )}

          {sel.key === "mail" && plan.mail && (
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
          )}

          {sel.key === "chart" && plan.chart && (
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
          )}
        </div>
      )}
    </div>
  );
}
