// Agent-grafen: hver agent er en flytende node i en 2D-klynge. Kategorien
// styrer klynge og farge; tilstanden styrer dybde (sover bakerst, jobber
// forrest), størrelse og glød. Ren Canvas 2D — lett nok til å stå åpen.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAgents,
  setAgentPersona,
  type AgentInfo,
  type AgentState,
} from "../../lib/api";
import { swallow } from "../../lib/log";
import { categoryColor, GraphSim, type Node } from "./sim";
import styles from "./Hub.module.css";

const POLL_MS = 5000;
const FPS_CAP = 30;

const STATE_LABEL: Record<AgentState, string> = {
  working: "jobber nå",
  thinking: "legger plan",
  broken: "trenger tilsyn",
  paused: "pauset",
  sleeping: "sover til neste vakt",
};

export default function Hub({
  onClose,
  onOpenChat,
}: {
  onClose: () => void;
  onOpenChat: (chatId: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef(new GraphSim());
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selected, setSelected] = useState<AgentInfo | null>(null);
  const [draft, setDraft] = useState({ name: "", personality: "", category: "" });

  // Render-løkke: FPS-tak, stopp når fanen er skjult, full opprydding.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const sim = simRef.current;
    const dpr = Math.min(window.devicePixelRatio, 2);
    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      canvas.width = clientWidth * dpr;
      canvas.height = clientHeight * dpr;
      sim.resize(clientWidth, clientHeight);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = (now - last) / 1000;
      last = now;
      if (document.hidden) return;
      acc += dt;
      if (acc < 1 / FPS_CAP) return;
      const step = Math.min(acc, 0.1);
      acc = 0;
      const t = now / 1000;
      sim.step(step, t);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      for (const n of sim.nodes) {
        const { h, s, l } = categoryColor(n.agent.category ?? "");
        const depth = n.depth;
        const r = n.r * (0.7 + depth * 0.5);
        const alpha = 0.35 + depth * 0.65;
        const state = n.agent.state ?? "sleeping";

        // Glød bak aktive noder.
        if (depth > 0.6) {
          const glow = ctx.createRadialGradient(n.x, n.y, r * 0.4, n.x, n.y, r * 2.2);
          glow.addColorStop(0, `hsla(${h}, ${s}%, ${l}%, ${0.25 * depth})`);
          glow.addColorStop(1, "transparent");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 2.2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Selve noden. Ødelagte får rød ring, pausede gråner.
        const lightness = state === "paused" ? 30 : l;
        const sat = state === "paused" ? 8 : s;
        ctx.globalAlpha = alpha;
        const fill = ctx.createRadialGradient(
          n.x - r * 0.3, n.y - r * 0.3, r * 0.2,
          n.x, n.y, r
        );
        fill.addColorStop(0, `hsl(${h}, ${sat}%, ${Math.min(88, lightness + 16)}%)`);
        fill.addColorStop(1, `hsl(${h}, ${sat}%, ${lightness - 12}%)`);
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (state === "broken") {
          ctx.strokeStyle = "hsla(4, 70%, 58%, 0.9)";
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
        if (selected && n.agent.id === selected.id) {
          ctx.strokeStyle = "rgba(232,232,228,0.9)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Navn under noden — kun godt lesbart på de fremste.
        if (depth > 0.25) {
          ctx.font = "500 11px system-ui, sans-serif";
          ctx.fillStyle = `rgba(226,226,222,${0.35 + depth * 0.55})`;
          ctx.textAlign = "center";
          ctx.fillText(n.agent.name, n.x, n.y + r + 14);
        }
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [selected]);

  // Polling av agentene.
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      fetchAgents()
        .then((list) => {
          if (!alive) return;
          setAgents(list);
          simRef.current.sync(list);
          // Hold kortet ferskt hvis den valgte er oppdatert.
          setSelected((sel) => (sel ? list.find((a) => a.id === sel.id) ?? null : null));
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

  const pick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const node: Node | null = simRef.current.pick(e.clientX - rect.left, e.clientY - rect.top);
    setSelected(node?.agent ?? null);
    if (node) {
      setDraft({
        name: node.agent.name,
        personality: node.agent.personality ?? "",
        category: node.agent.category ?? "",
      });
    }
  }, []);

  const save = useCallback(async () => {
    if (!selected) return;
    try {
      await setAgentPersona(selected.id, {
        name: draft.name,
        personality: draft.personality,
        category: draft.category,
      });
      const list = await fetchAgents();
      setAgents(list);
      simRef.current.sync(list);
      setSelected(list.find((a) => a.id === selected.id) ?? null);
    } catch {
      // Ikke kritisk — brukeren kan prøve igjen.
    }
  }, [selected, draft]);

  const categories = [...new Set(agents.map((a) => a.category).filter(Boolean))] as string[];

  return (
    <div className={styles.hub}>
      <canvas ref={canvasRef} className={styles.canvas} onClick={pick} />

      <div className={styles.topBar}>
        <span className={styles.title}>Agenter</span>
        <span className={styles.count}>
          {agents.length} {agents.length === 1 ? "agent" : "agenter"}
          {categories.length > 0 && ` i ${categories.length + (agents.some((a) => !a.category) ? 1 : 0)} klynger`}
        </span>
        <button className={styles.close} onClick={onClose} title="Lukk (Esc)">
          ✕
        </button>
      </div>

      {selected && (
        <div className={styles.card}>
          <input
            className={styles.cardName}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            onBlur={save}
          />
          <div className={styles.cardState}>
            {STATE_LABEL[selected.state ?? "sleeping"]}
          </div>
          {selected.task && <p className={styles.cardTask}>{selected.task}</p>}
          {selected.schedule_label && (
            <div className={styles.cardMeta}>{selected.schedule_label}</div>
          )}
          <input
            className={styles.cardInput}
            placeholder="Kategori - f.eks. økonomi"
            value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
            onBlur={save}
            list="hub-categories"
          />
          <datalist id="hub-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <textarea
            className={styles.cardPersonality}
            placeholder="Personlighet - f.eks. «gretten men grundig»"
            value={draft.personality}
            onChange={(e) => setDraft((d) => ({ ...d, personality: e.target.value }))}
            onBlur={save}
            rows={2}
          />
          <div className={styles.cardActions}>
            <button
              className={styles.cardBtn}
              onClick={() => {
                if (selected.chat_id) {
                  onClose();
                  onOpenChat(selected.chat_id);
                }
              }}
            >
              Åpne chat
            </button>
            <button className={styles.cardBtnGhost} onClick={() => setSelected(null)}>
              Lukk
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
