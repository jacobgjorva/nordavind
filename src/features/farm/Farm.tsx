// Farmen: 3D-verdenen der agentene lever som troll. Lazy-lastes så three.js
// aldri belaster chat-bundelen. Polling gir live-tilstander; selve verdenen
// eies av FarmScene (scene.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAgents,
  setAgentPersona,
  type AgentInfo,
  type AgentState,
} from "../../lib/api";
import { swallow } from "../../lib/log";
import { FarmScene } from "./scene";
import styles from "./Farm.module.css";

const POLL_MS = 5000;

const STATE_LABEL: Record<AgentState, string> = {
  working: "skriver rapport",
  thinking: "tenker ut en plan",
  broken: "har slått seg vrang",
  paused: "tar pause",
  sleeping: "sover til neste vakt",
};

export default function Farm({
  onClose,
  onOpenChat,
}: {
  onClose: () => void;
  onOpenChat: (chatId: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<FarmScene | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selected, setSelected] = useState<AgentInfo | null>(null);
  const [personaDraft, setPersonaDraft] = useState({ name: "", personality: "" });
  const [summon, setSummon] = useState("");
  const [modelStatus, setModelStatus] = useState("laster modeller …");

  // Scene-livssyklus: bygg ved mount, riv ved unmount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new FarmScene(canvas);
    scene.onPick = (agent) => {
      setSelected(agent);
      setPersonaDraft({ name: agent.name, personality: agent.personality ?? "" });
    };
    scene.onModelStatus = setModelStatus;
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Polling: hent agentene, oppdater trollene. Hopper over når fanen er skjult.
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      fetchAgents()
        .then((list) => {
          if (!alive) return;
          setAgents(list);
          sceneRef.current?.syncAgents(list);
        })
        .catch(swallow);
    };
    load();
    const iv = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  // Esc lukker kortet først, så farmen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelected((s) => {
        if (s) return null;
        onClose();
        return s;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const savePersona = useCallback(async () => {
    if (!selected) return;
    try {
      await setAgentPersona(selected.id, {
        name: personaDraft.name,
        personality: personaDraft.personality,
      });
      const list = await fetchAgents();
      setAgents(list);
      sceneRef.current?.syncAgents(list);
      setSelected(list.find((a) => a.id === selected.id) ?? null);
    } catch {
      // Ikke kritisk — brukeren kan prøve igjen.
    }
  }, [selected, personaDraft]);

  // @-summon: match agentnavn, åpne agentens chat.
  const matches = summon.startsWith("@")
    ? agents.filter((a) =>
        a.name.toLowerCase().includes(summon.slice(1).toLowerCase())
      )
    : [];

  const summonAgent = useCallback(
    (agent: AgentInfo) => {
      if (agent.chat_id) {
        onClose();
        onOpenChat(agent.chat_id);
      }
    },
    [onClose, onOpenChat]
  );

  return (
    <div className={styles.farm}>
      <canvas ref={canvasRef} className={styles.canvas} />

      <div className={styles.topBar}>
        <span className={styles.title}>Trollskogen</span>
        <span className={styles.count}>
          {agents.length === 1 ? "1 troll" : `${agents.length} troll`} - {modelStatus}
        </span>
        <button className={styles.close} onClick={onClose} title="Lukk (Esc)">
          ✕
        </button>
      </div>

      {selected && (
        <div className={styles.card}>
          <input
            className={styles.cardName}
            value={personaDraft.name}
            onChange={(e) =>
              setPersonaDraft((d) => ({ ...d, name: e.target.value }))
            }
            onBlur={savePersona}
          />
          <div className={styles.cardState}>
            {STATE_LABEL[selected.state ?? "sleeping"]}
          </div>
          {selected.task && <p className={styles.cardTask}>{selected.task}</p>}
          {selected.schedule_label && (
            <div className={styles.cardMeta}>{selected.schedule_label}</div>
          )}
          <textarea
            className={styles.cardPersonality}
            placeholder="Personlighet - f.eks. «gretten men grundig»"
            value={personaDraft.personality}
            onChange={(e) =>
              setPersonaDraft((d) => ({ ...d, personality: e.target.value }))
            }
            onBlur={savePersona}
            rows={2}
          />
          <div className={styles.cardActions}>
            <button
              className={styles.cardBtn}
              onClick={() => selected.chat_id && summonAgent(selected)}
            >
              Åpne chat
            </button>
            <button
              className={styles.cardBtnGhost}
              onClick={() => setSelected(null)}
            >
              Lukk
            </button>
          </div>
        </div>
      )}

      <div className={styles.summon}>
        {matches.length > 0 && (
          <div className={styles.summonList}>
            {matches.slice(0, 5).map((a) => (
              <button
                key={a.id}
                className={styles.summonItem}
                onClick={() => summonAgent(a)}
              >
                {a.name}
                <span className={styles.summonState}>
                  {STATE_LABEL[a.state ?? "sleeping"]}
                </span>
              </button>
            ))}
          </div>
        )}
        <input
          className={styles.summonInput}
          placeholder="@agent-navn for å hente et troll"
          value={summon}
          onChange={(e) => setSummon(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) summonAgent(matches[0]);
          }}
        />
      </div>
    </div>
  );
}
