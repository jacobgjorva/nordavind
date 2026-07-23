import { createContext, useContext, useState } from "react";
import { approveMission, setMissionPlan } from "../../lib/api";
import { registerBlock } from "../../features/chat/blocks/registry";
import { emit } from "../../lib/events";
import styles from "./AgentWidgets.module.css";

// Agenten som eier den åpne chatten. Settes av Chat, leses av start-kortet
// (blokker rendres kontekst-fritt, så id må komme via context).
export const AgentChatContext = createContext<string | null>(null);

interface Plan {
  goal?: string;
  criteria?: string;
  budget?: number;
}

// Start-kort (samme som vi bruker for å aktivere agenter): agentens navn + én
// Start-knapp. Selve planen står i chatten over kortet; her bekrefter brukeren
// bare at oppdraget skal settes i gang.
function MissionPlanCard({ plan }: { plan: Plan }) {
  const agentId = useContext(AgentChatContext);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy || done || !agentId) return;
    setBusy(true);
    setError(null);
    try {
      await setMissionPlan(agentId, {
        goal: plan.goal ?? "",
        criteria: plan.criteria ?? "",
        budget: plan.budget ?? 100000,
      });
      await approveMission(agentId);
      setDone(true);
      emit("agents-changed");
    } catch {
      setError("Kunne ikke starte oppdraget.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return null;

  return (
    <div className={styles.startCard}>
      <span className={styles.startName}>{plan.goal || "Oppdrag"}</span>
      {error && <span className={styles.startError}>{error}</span>}
      <button
        type="button"
        className={styles.startBtn}
        onClick={start}
        disabled={busy || !agentId}
      >
        {busy ? "…" : "Start"}
      </button>
    </div>
  );
}

registerBlock("mission_plan", (body) => {
  const plan = JSON.parse(body) as Plan;
  return <MissionPlanCard plan={plan} />;
});
