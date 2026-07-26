// Agent-grafen: hver agent er én tråd gjennom tiden (baneskjema-stil).
// Flat tråd = sover, bølgepakke = en kjøring, prikk = svar (lysende = ulest),
// levende bølge i høyrekanten = kjører akkurat nå. Ren Canvas 2D.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAgentRuns,
  fetchAgents,
  setAgentPersona,
  type AgentInfo,
  type AgentRunEvent,
  type AgentState,
} from "../../lib/api";
import { swallow } from "../../lib/log";
import { layoutStrands, PAD_X, strandY, type Strand } from "./strands";
import styles from "./Hub.module.css";

const POLL_MS = 5000;
const FPS_CAP = 30;
const WINDOW_MS = 24 * 3600 * 1000; // vindu: siste døgn

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
  const strandsRef = useRef<Strand[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selected, setSelected] = useState<AgentInfo | null>(null);
  const [draft, setDraft] = useState({ name: "", personality: "", category: "" });

  // Render-løkke: FPS-tak, stopp når fanen er skjult.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio, 2);
    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      const dt = (nowMs - last) / 1000;
      last = nowMs;
      if (document.hidden) return;
      acc += dt;
      if (acc < 1 / FPS_CAP) return;
      acc = 0;
      const t = nowMs / 1000;
      const now = Date.now();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Tidsakse: stiplete markører hver 6. time + «nå» ved høyre kant.
      ctx.font = "500 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      for (let back = 24; back >= 0; back -= 6) {
        const x = PAD_X + ((WINDOW_MS - back * 3600 * 1000) / WINDOW_MS) * (w - PAD_X - 24);
        ctx.strokeStyle = "rgba(226,226,222,0.07)";
        ctx.beginPath();
        ctx.moveTo(x, 54);
        ctx.lineTo(x, h - 20);
        ctx.stroke();
        ctx.fillStyle = "rgba(226,226,222,0.35)";
        ctx.fillText(back === 0 ? "nå" : `-${back}t`, x, 46);
      }

      for (const s of strandsRef.current) {
        const state = s.agent.state ?? "sleeping";
        const dim = state === "paused";
        ctx.strokeStyle = dim ? "#3a3b40" : s.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = dim ? 0.6 : 0.92;

        // Tråden, samplet i 6 px-steg.
        ctx.beginPath();
        for (let x = PAD_X; x <= w - 24; x += 2) {
          const y = strandY(s, x, w, WINDOW_MS, now, t);
          if (x === PAD_X) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        if (state === "broken") {
          // Rød hale ytterst: noe er galt nå.
          ctx.strokeStyle = "hsla(4, 70%, 58%, 0.9)";
          ctx.beginPath();
          for (let x = w - 90; x <= w - 24; x += 2) {
            const y = strandY(s, x, w, WINDOW_MS, now, t);
            if (x === w - 90) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }

        // Svar-prikker på kjøringer med resultat; siste er lysende hvis ulest.
        const withOutput = s.runs.filter((r) => r.has_output);
        withOutput.forEach((r, i) => {
          const x =
            PAD_X + ((Date.parse(r.started_at) - (now - WINDOW_MS)) / WINDOW_MS) * (w - PAD_X - 24);
          if (x < PAD_X) return;
          const y = strandY(s, x, w, WINDOW_MS, now, t);
          const unread = s.agent.has_response && i === withOutput.length - 1;
          ctx.beginPath();
          ctx.arc(x, y, unread ? 5 : 3, 0, Math.PI * 2);
          ctx.fillStyle = unread ? "#f2e39a" : s.color;
          ctx.fill();
          if (unread) {
            ctx.beginPath();
            ctx.arc(x, y, 8 + Math.sin(t * 3) * 1.5, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(242,227,154,0.5)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.lineWidth = 2;
          }
        });

        // Navn ved venstre kant, på trådens bane.
        ctx.globalAlpha = 1;
        ctx.font = "500 11px system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.fillStyle =
          selected?.id === s.agent.id ? "#f0f0ec" : "rgba(226,226,222,0.7)";
        ctx.fillText(s.agent.name, PAD_X - 10, s.laneY + 4);
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [selected]);

  // Polling: agenter + kjøringshistorikk.
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      Promise.all([fetchAgents(), fetchAgentRuns(24)])
        .then(([list, runs]: [AgentInfo[], AgentRunEvent[]]) => {
          if (!alive) return;
          setAgents(list);
          const canvas = canvasRef.current;
          strandsRef.current = layoutStrands(list, runs, canvas?.clientHeight ?? 600);
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

  // Klikk: nærmeste tråd innen 14 px (navn ved venstre kant treffer også).
  const pick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    let best: Strand | null = null;
    let bestD = 14;
    for (const s of strandsRef.current) {
      const d = Math.abs(s.laneY - y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    setSelected(best?.agent ?? null);
    if (best) {
      setDraft({
        name: best.agent.name,
        personality: best.agent.personality ?? "",
        category: best.agent.category ?? "",
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
      const [list, runs] = await Promise.all([fetchAgents(), fetchAgentRuns(24)]);
      setAgents(list);
      strandsRef.current = layoutStrands(list, runs, canvasRef.current?.clientHeight ?? 600);
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
          {agents.length} {agents.length === 1 ? "agent" : "agenter"} - siste døgn
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
