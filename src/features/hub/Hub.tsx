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
import {
  computeSpan,
  layoutStrands,
  predictedRuns,
  strandY,
  timeToX,
  type Strand,
} from "./strands";
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
  const strandsRef = useRef<Strand[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selected, setSelected] = useState<AgentInfo | null>(null);
  const [draft, setDraft] = useState({ name: "", personality: "", category: "" });
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Ekspandert svar-pille (agentId + started_at); null = alle kollapset.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [, setTick] = useState(0); // re-render ved poll så pillene følger tiden

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
      setSize({ w: canvas.clientWidth, h: canvas.clientHeight });
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
      const span = computeSpan(w);

      // Tidsakse: markører hver 6. time, fortid og fremtid; «nå» i midten.
      ctx.font = "500 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      for (let off = -24; off <= 24; off += 6) {
        const x = timeToX(now + off * 3600 * 1000, span, now);
        ctx.strokeStyle = off === 0 ? "rgba(226,226,222,0.22)" : "rgba(226,226,222,0.07)";
        ctx.beginPath();
        ctx.moveTo(x, 54);
        ctx.lineTo(x, h - 20);
        ctx.stroke();
        ctx.fillStyle = off === 0 ? "rgba(226,226,222,0.6)" : "rgba(226,226,222,0.35)";
        ctx.fillText(off === 0 ? "nå" : `${off > 0 ? "+" : ""}${off}t`, x, 46);
      }
      const nowX = timeToX(now, span, now);

      // Tegner en trådstrekning [fra, til] med gjeldende strokeStyle.
      const strokeSegment = (s: Strand, from: number, to: number) => {
        ctx.beginPath();
        for (let x = from; x <= to; x += 2) {
          const y = strandY(s, x, span, now, t);
          if (x === from) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };

      for (const s of strandsRef.current) {
        const state = s.agent.state ?? "sleeping";
        const dim = state === "paused";
        ctx.lineWidth = 0.8;
        ctx.globalAlpha = dim ? 0.6 : 0.9;

        // Fortid i kategorifarge, fremtid i grått — prediksjon, ikke fasit.
        ctx.strokeStyle = dim ? "#3a3b40" : s.color;
        strokeSegment(s, span.x0, nowX);
        ctx.strokeStyle = "#55565c";
        ctx.globalAlpha = dim ? 0.4 : 0.55;
        strokeSegment(s, nowX, span.x1);
        ctx.globalAlpha = dim ? 0.6 : 0.9;

        if (state === "broken") {
          // Rød hale inn mot nå-linja: noe er galt.
          ctx.strokeStyle = "hsla(4, 70%, 58%, 0.9)";
          strokeSegment(s, nowX - 70, nowX);
        }

        // Glødende etterslep etter et svar (fortid, kategori-lyst); ulest
        // pulserer varmt. Predikerte svar får et svakt grått etterslep.
        const glowTail = (runX: number, rgb: string, peak: number, width: number) => {
          const len = 34;
          const grad = ctx.createLinearGradient(runX, 0, runX + len, 0);
          grad.addColorStop(0, `rgba(${rgb},${peak})`);
          grad.addColorStop(1, `rgba(${rgb},0)`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = width;
          const from = Math.max(span.x0, runX);
          const to = Math.min(span.x1, runX + len);
          if (to > from) strokeSegment(s, from, to);
          ctx.lineWidth = 0.8;
        };
        for (const ms of predictedRuns(s.agent, now)) {
          glowTail(timeToX(ms, span, now), "150,152,158", 0.35, 1);
        }

        // Navn ved venstre kant, på trådens bane.
        ctx.globalAlpha = 1;
        ctx.font = "500 11px system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.fillStyle =
          selected?.id === s.agent.id ? "#f0f0ec" : "rgba(226,226,222,0.7)";
        ctx.fillText(s.agent.name, span.x0 - 12, s.laneY + 4);
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
          setTick((n) => n + 1);
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

  // Svar-piller: én per kjøring i vinduet. «Funn!» når kjøringen fant noe
  // med verdi, ellers «Ingen funn». Klikk ekspanderer til hele meldingen.
  const pillNow = Date.now();
  const pillSpan = size.w ? computeSpan(size.w) : null;
  const pills = pillSpan
    ? strandsRef.current.flatMap((s) => {
        const withOutput = s.runs.filter((r) => r.has_output);
        const lastOutput = withOutput[withOutput.length - 1];
        return s.runs
          .map((r) => {
            const x = timeToX(Date.parse(r.started_at), pillSpan, pillNow) + 10;
            if (x < pillSpan.x0 + 10 || x > pillSpan.x1 - 10) return null;
            const key = `${s.agent.id}:${r.started_at}`;
            return {
              key,
              x,
              y: s.laneY,
              found: !!r.alert,
              unread: !!s.agent.has_response && r === lastOutput,
              output: r.output ?? "",
            };
          })
          .filter(Boolean) as {
          key: string;
          x: number;
          y: number;
          found: boolean;
          unread: boolean;
          output: string;
        }[];
      })
    : [];

  return (
    <div className={styles.hub}>
      <canvas ref={canvasRef} className={styles.canvas} onClick={pick} />

      <div className={styles.pillLayer}>
        {pills.map((p) =>
          expanded === p.key ? (
            <div
              key={p.key}
              className={styles.pillOpen}
              style={{ left: p.x, top: p.y - 14 }}
              onClick={() => setExpanded(null)}
            >
              {p.output || "Ingen endring siden forrige kjøring."}
            </div>
          ) : (
            <button
              key={p.key}
              className={`${styles.pill} ${p.found ? styles.pillFunn : ""} ${
                p.unread ? styles.pillUnread : ""
              }`}
              style={{ left: p.x, top: p.y - 14 }}
              onClick={() => setExpanded(p.key)}
            >
              {p.found ? "Funn!" : "Ingen funn"}
            </button>
          )
        )}
      </div>

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
