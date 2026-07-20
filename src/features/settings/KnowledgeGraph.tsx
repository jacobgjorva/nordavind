import { useEffect, useRef, useState } from "react";
import { swallow } from "../../lib/log";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete01Icon } from "@hugeicons/core-free-icons";
import {
  fetchKnowledgeGraph,
  updateNode,
  deleteNode,
  type GraphData,
} from "../../lib/api";
import styles from "./KnowledgeGraph.module.css";

interface Sim {
  id: string;
  title: string;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const TYPE_COLOR: Record<string, string> = {
  term: "#6ea8fe",
  prosess: "#6ef16a",
  regel: "#C2D7EF",
  entitet: "#c9a8ff",
  dokument: "#f4c15a",
};

const W = 640;
const H = 420;

// Obsidian-aktig kunnskapsgraf: enkel kraft-simulering i SVG, ingen bibliotek.
export function KnowledgeGraph() {
  const [data, setData] = useState<GraphData | null>(null);
  const [nodes, setNodes] = useState<Sim[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const dragId = useRef<string | null>(null);
  const moved = useRef(false);
  const raf = useRef<number>(0);

  const selected = data?.nodes.find((n) => n.id === selId) ?? null;

  useEffect(() => {
    if (selected) {
      setTitle(selected.title);
      setSummary(selected.summary);
    }
  }, [selId]);

  async function saveNode() {
    const id = selId;
    setSelId(null);
    if (!id) return;
    const t = title.trim();
    const s = summary.trim();
    if (!s || (t === selected?.title && s === selected?.summary)) return;
    setData((d) =>
      d
        ? {
            ...d,
            nodes: d.nodes.map((n) =>
              n.id === id ? { ...n, summary: s } : n
            ),
          }
        : d
    );
    updateNode(id, t, s).catch(swallow);
  }

  // Sletter valgt node. onMouseDown (ikke onClick) så textarea ikke rekker å
  // blurre og lagre først.
  function removeNode() {
    const id = selId;
    if (!id) return;
    setSelId(null);
    setData((d) =>
      d
        ? {
            nodes: d.nodes.filter((n) => n.id !== id),
            edges: d.edges.filter((e) => e.from_id !== id && e.to_id !== id),
          }
        : d
    );
    setNodes((ns) => ns.filter((n) => n.id !== id));
    deleteNode(id).catch(swallow);
  }

  useEffect(() => {
    fetchKnowledgeGraph()
      .then(setData)
      .catch(() => setData({ nodes: [], edges: [] }));
  }, []);

  // Init posisjoner i en sirkel.
  useEffect(() => {
    if (!data) return;
    const n = data.nodes.length;
    setNodes(
      data.nodes.map((node, i) => {
        const a = (i / Math.max(1, n)) * Math.PI * 2;
        return {
          id: node.id,
          title: node.title,
          type: node.type,
          x: W / 2 + Math.cos(a) * 140,
          y: H / 2 + Math.sin(a) * 120,
          vx: 0,
          vy: 0,
        };
      })
    );
  }, [data]);

  // Kraft-simulering: frastøtning mellom noder, fjærer langs kanter, sentrering.
  useEffect(() => {
    if (!data || nodes.length === 0) return;
    const edges = data.edges;
    function step() {
      setNodes((prev) => {
        const next = prev.map((n) => ({ ...n }));
        for (let i = 0; i < next.length; i++) {
          const a = next[i];
          if (a.id === dragId.current) continue;
          // Frastøtning
          for (let j = 0; j < next.length; j++) {
            if (i === j) continue;
            const b = next[j];
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let d2 = dx * dx + dy * dy || 0.01;
            const f = 2600 / d2;
            a.vx += (dx / Math.sqrt(d2)) * f;
            a.vy += (dy / Math.sqrt(d2)) * f;
          }
          // Sentrering
          a.vx += (W / 2 - a.x) * 0.008;
          a.vy += (H / 2 - a.y) * 0.008;
        }
        // Fjærer langs kanter
        const idx = new Map(next.map((n, i) => [n.id, i]));
        for (const e of edges) {
          const ia = idx.get(e.from_id);
          const ib = idx.get(e.to_id);
          if (ia == null || ib == null) continue;
          const a = next[ia];
          const b = next[ib];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const f = (d - 110) * 0.02;
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          if (a.id !== dragId.current) {
            a.vx += fx;
            a.vy += fy;
          }
          if (b.id !== dragId.current) {
            b.vx -= fx;
            b.vy -= fy;
          }
        }
        for (const n of next) {
          if (n.id === dragId.current) continue;
          n.vx *= 0.82;
          n.vy *= 0.82;
          n.x = Math.max(24, Math.min(W - 24, n.x + n.vx));
          n.y = Math.max(24, Math.min(H - 24, n.y + n.vy));
        }
        return next;
      });
      raf.current = requestAnimationFrame(step);
    }
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [data, nodes.length]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!dragId.current) return;
    moved.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    setNodes((prev) =>
      prev.map((n) =>
        n.id === dragId.current ? { ...n, x, y, vx: 0, vy: 0 } : n
      )
    );
  }

  if (!data) return null;
  if (data.nodes.length === 0) {
    return <div className={styles.empty}>Ingen godkjente noder ennå.</div>;
  }

  const pos = new Map(nodes.map((n) => [n.id, n]));
  const selPos = selId ? pos.get(selId) : null;

  return (
    <div className={styles.wrap}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.svg}
        onMouseMove={onMove}
        onMouseUp={() => (dragId.current = null)}
        onMouseLeave={() => (dragId.current = null)}
      >
        {data.edges.map((e, i) => {
          const a = pos.get(e.from_id);
          const b = pos.get(e.to_id);
          if (!a || !b) return null;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={styles.edge}
            />
          );
        })}
        {nodes.map((n) => (
          <g
            key={n.id}
            transform={`translate(${n.x},${n.y})`}
            onMouseDown={() => {
              dragId.current = n.id;
              moved.current = false;
            }}
            onMouseUp={() => {
              if (!moved.current) setSelId(n.id);
            }}
            onMouseEnter={() => setHover(n.id)}
            onMouseLeave={() => setHover(null)}
            className={styles.node}
          >
            {n.type === "dokument" ? (
              // Dokumenter tegnes som en rundet firkant så de skiller seg fra
              // de sirkulære graf-nodene (de er kilder, ikke fakta).
              (() => {
                const s = hover === n.id || selId === n.id ? 8 : 6;
                return (
                  <rect
                    x={-s}
                    y={-s}
                    width={s * 2}
                    height={s * 2}
                    rx={2}
                    fill={TYPE_COLOR.dokument}
                    stroke={selId === n.id ? "#fff" : "none"}
                    strokeWidth={1.5}
                  />
                );
              })()
            ) : (
              <circle
                r={hover === n.id || selId === n.id ? 8 : 6}
                fill={TYPE_COLOR[n.type] ?? "#8a8a90"}
                stroke={selId === n.id ? "#fff" : "none"}
                strokeWidth={1.5}
              />
            )}
            <text x={11} y={4} className={styles.nodeLabel}>
              {n.title}
            </text>
          </g>
        ))}
      </svg>

      {selected && selPos && (
        <div
          className={styles.tooltipWrap}
          style={{
            left: `${(selPos.x / W) * 100}%`,
            top: `${(selPos.y / H) * 100}%`,
          }}
        >
          <textarea
            className={styles.tooltip}
            value={summary}
            autoFocus
            rows={3}
            onChange={(e) => setSummary(e.target.value)}
            onBlur={saveNode}
          />
          <button
            type="button"
            className={styles.tooltipDel}
            onMouseDown={(e) => {
              e.preventDefault();
              removeNode();
            }}
            aria-label="Slett"
          >
            <HugeiconsIcon icon={Delete01Icon} size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
