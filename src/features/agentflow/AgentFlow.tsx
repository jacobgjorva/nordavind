// Flyt-visningen: agentens kompilerte plan som en node-graf brukeren kan
// redigere. Planen ER JSON-en agenten kjører — det som endres her, endrer
// hva agenten faktisk gjør. Serveren prøvekjører hvert steg før lagring, så
// en ødelagt spørring kan ikke lagres.
import { useCallback, useEffect, useState } from "react";
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
  const [open, setOpen] = useState<string | null>(null); // hvilken node er åpen
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(() => {
    fetchAgentPlan(agentId)
      .then((res) => {
        setPlan(res.plan);
        setMeta({
          status: res.status,
          schedule: res.schedule_label,
          name: res.agent_name,
        });
      })
      .catch(() => setPlan(null));
  }, [agentId]);

  useEffect(load, [load]);

  // Bygger planen? Poll til den er klar.
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

  const removeStep = (i: number) => {
    setPlan((p) => (p ? { ...p, steps: p.steps.filter((_, j) => j !== i) } : p));
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
      // Serveren svarer med {problems:[...]} ved valideringsfeil; meldingen
      // bærer JSON-en videre gjennom ApiError.
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
            <button className={styles.rebuild} onClick={rebuild}>
              Bygg plan
            </button>
          )}
        </div>
      </div>
    );
  }

  const node = (key: string, title: string, sub: string, body: React.ReactNode) => (
    <div className={`${styles.node} ${open === key ? styles.nodeOpen : ""}`}>
      <button
        className={styles.nodeHead}
        onClick={() => setOpen(open === key ? null : key)}
      >
        <span className={styles.nodeTitle}>{title}</span>
        <span className={styles.nodeSub}>{sub}</span>
      </button>
      {open === key && <div className={styles.nodeBody}>{body}</div>}
    </div>
  );

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
        <div className={styles.chain}>
          <div className={styles.start}>Start</div>
          <div className={styles.arrow} />

          {plan.steps.map((s, i) => (
            <div key={i} className={styles.chainItem}>
              {node(
                `step-${i}`,
                s.label || `Steg ${i + 1}`,
                KIND_LABEL[s.kind] ?? s.kind,
                <>
                  <label className={styles.field}>
                    Navn
                    <input
                      value={s.label}
                      onChange={(e) => patchStep(i, { label: e.target.value })}
                    />
                  </label>
                  {s.kind === "sql" && (
                    <label className={styles.field}>
                      Spørring
                      <textarea
                        rows={5}
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
                  <button className={styles.remove} onClick={() => removeStep(i)}>
                    Fjern steget
                  </button>
                </>
              )}
              <div className={styles.arrow} />
            </div>
          ))}

          {node(
            "watch",
            "Vurder resultatet",
            "regel",
            <>
              <label className={styles.field}>
                Dette følges med på
                <textarea
                  rows={2}
                  value={plan.watch}
                  onChange={(e) => patch({ watch: e.target.value })}
                />
              </label>
              <label className={styles.field}>
                Si fra når
                <textarea
                  rows={2}
                  value={plan.alert_rule}
                  onChange={(e) => patch({ alert_rule: e.target.value })}
                />
              </label>
            </>
          )}

          {/* Forgreningen: funn eller ikke. */}
          <div className={styles.branch}>
            <div className={styles.branchArm}>
              <span className={styles.branchLabel}>Funn</span>
              <div className={styles.leaf}>
                Varsel i chatten
                {plan.mail && ` + e-post til ${plan.mail.to_email}`}
              </div>
            </div>
            <div className={styles.branchArm}>
              <span className={styles.branchLabel}>Ingen funn</span>
              <div className={styles.leafQuiet}>Stille</div>
            </div>
          </div>

          {plan.mail &&
            node(
              "mail",
              "E-post",
              plan.mail.to_email,
              <>
                <label className={styles.field}>
                  Mottaker
                  <input
                    value={plan.mail.to_email}
                    onChange={(e) =>
                      patch({ mail: { ...plan.mail!, to_email: e.target.value } })
                    }
                  />
                </label>
                <label className={styles.field}>
                  Emne
                  <input
                    value={plan.mail.subject}
                    onChange={(e) =>
                      patch({ mail: { ...plan.mail!, subject: e.target.value } })
                    }
                  />
                </label>
                <button className={styles.remove} onClick={() => patch({ mail: null })}>
                  Slutt å sende e-post
                </button>
              </>
            )}

          {plan.chart &&
            node(
              "chart",
              "Graf",
              plan.chart.title,
              <>
                <label className={styles.field}>
                  Tittel
                  <input
                    value={plan.chart.title}
                    onChange={(e) =>
                      patch({ chart: { ...plan.chart!, title: e.target.value } })
                    }
                  />
                </label>
                <label className={styles.field}>
                  Spørring
                  <textarea
                    rows={4}
                    value={plan.chart.sql}
                    onChange={(e) =>
                      patch({ chart: { ...plan.chart!, sql: e.target.value } })
                    }
                  />
                </label>
                <button className={styles.remove} onClick={() => patch({ chart: null })}>
                  Fjern grafen
                </button>
              </>
            )}
        </div>

        {plan.approach && <p className={styles.approach}>{plan.approach}</p>}
      </div>
    </div>
  );
}
