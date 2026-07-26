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
  deg: number;
}

const HEIGHT = 440;

// Fargespråket: mørk flate, kanter i en lilla→rosa→krem-gradient (varmest mot
// sentrum), noder som små lyse mint-punkter med glød. Dokument-noder gull.
const BG = "#050507";
const NODE_MINT = "#8df0c6";
const NODE_DOC = "#f4c15a";
const EDGE_STOPS: [number, number, number][] = [
  [244, 205, 160], // sentrum: varm krem
  [224, 139, 208], // midt: rosa
  [91, 63, 212], // ytterkant: dyp lilla
];

function edgeColor(t: number, alpha: number): string {
  // t 0 = sentrum, 1 = ytterkant; lineær blanding over de tre stoppene.
  const seg = t < 0.5 ? 0 : 1;
  const u = (t - seg * 0.5) * 2;
  const a = EDGE_STOPS[seg];
  const b = EDGE_STOPS[seg + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * u);
  const g = Math.round(a[1] + (b[1] - a[1]) * u);
  const bl = Math.round(a[2] + (b[2] - a[2]) * u);
  return `rgba(${r},${g},${bl},${alpha})`;
}

// Stabil pseudotilfeldig kurvatur per kant, så grafen ser organisk ut uten å
// flimre mellom frames.
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

// Organisk kunnskapsgraf på canvas: kraft-simulering med romlig rutenett for
// frastøtning (tåler tusenvis av noder), additiv glød, zoom/pan og redigering.
export function KnowledgeGraph() {
  const [data, setData] = useState<GraphData | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [cardPos, setCardPos] = useState<{ x: number; y: number } | null>(null);
  const [summary, setSummary] = useState("");
  const [title, setTitle] = useState("");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<Sim[]>([]);
  const hoverRef = useRef<string | null>(null);
  const dragRef = useRef<string | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  // Verdenstransform: sentrert i (0,0), auto-tilpasses til brukeren tar styring.
  const viewRef = useRef({ x: 0, y: 0, k: 1, user: false });
  const mouseRef = useRef<{ x: number; y: number } | null>(null);

  const selected = data?.nodes.find((n) => n.id === selId) ?? null;

  useEffect(() => {
    if (selected) {
      setTitle(selected.title);
      setSummary(selected.summary);
    }
  }, [selId]);

  function saveNode() {
    const id = selId;
    setSelId(null);
    if (!id) return;
    const t = title.trim();
    const s = summary.trim();
    if (!s || (t === selected?.title && s === selected?.summary)) return;
    setData((d) =>
      d
        ? { ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, summary: s } : n)) }
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
    simRef.current = simRef.current.filter((n) => n.id !== id);
    deleteNode(id).catch(swallow);
  }

  useEffect(() => {
    fetchKnowledgeGraph()
      .then(setData)
      .catch(() => setData({ nodes: [], edges: [] }));
  }, []);

  // Init: noder spres i en spiral rundt origo; grad beregnes for størrelse.
  useEffect(() => {
    if (!data) return;
    const deg = new Map<string, number>();
    for (const e of data.edges) {
      deg.set(e.from_id, (deg.get(e.from_id) ?? 0) + 1);
      deg.set(e.to_id, (deg.get(e.to_id) ?? 0) + 1);
    }
    simRef.current = data.nodes.map((node, i) => {
      const a = i * 2.399963; // gullvinkel — jevn spiral uansett antall
      const r = 14 * Math.sqrt(i + 1);
      return {
        id: node.id,
        title: node.title,
        type: node.type,
        x: Math.cos(a) * r,
        y: Math.sin(a) * r,
        vx: 0,
        vy: 0,
        deg: deg.get(node.id) ?? 0,
      };
    });
    viewRef.current.user = false;
  }, [data]);

  // Simulering + tegning i samme rAF-løkke — React røres aldri per frame.
  useEffect(() => {
    if (!data) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const dpr = window.devicePixelRatio || 1;

    function step() {
      const nodes = simRef.current;
      const w = wrap!.clientWidth;
      const h = HEIGHT;
      if (canvas!.width !== w * dpr || canvas!.height !== h * dpr) {
        canvas!.width = w * dpr;
        canvas!.height = h * dpr;
        canvas!.style.height = `${h}px`;
      }

      // --- Krefter. Frastøtning via romlig rutenett: O(n · naboceller). ---
      const cell = 60;
      const grid = new Map<string, number[]>();
      for (let i = 0; i < nodes.length; i++) {
        const key = `${Math.floor(nodes[i].x / cell)}:${Math.floor(nodes[i].y / cell)}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(i);
        else grid.set(key, [i]);
      }
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        if (a.id === dragRef.current) continue;
        const cx = Math.floor(a.x / cell);
        const cy = Math.floor(a.y / cell);
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          for (let gy = cy - 1; gy <= cy + 1; gy++) {
            const bucket = grid.get(`${gx}:${gy}`);
            if (!bucket) continue;
            for (const j of bucket) {
              if (i === j) continue;
              const b = nodes[j];
              const dx = a.x - b.x;
              const dy = a.y - b.y;
              const d2 = dx * dx + dy * dy || 0.01;
              if (d2 > cell * cell * 4) continue;
              const f = 900 / d2;
              const d = Math.sqrt(d2);
              a.vx += (dx / d) * f;
              a.vy += (dy / d) * f;
            }
          }
        }
        // Sentrering mot origo — svakere for hub-noder så de får bre seg.
        a.vx += -a.x * 0.004;
        a.vy += -a.y * 0.004;
      }
      const idx = new Map(nodes.map((n, i) => [n.id, i]));
      for (const e of data!.edges) {
        const ia = idx.get(e.from_id);
        const ib = idx.get(e.to_id);
        if (ia == null || ib == null) continue;
        const a = nodes[ia];
        const b = nodes[ib];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = (d - 70) * 0.015;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        if (a.id !== dragRef.current) {
          a.vx += fx;
          a.vy += fy;
        }
        if (b.id !== dragRef.current) {
          b.vx -= fx;
          b.vy -= fy;
        }
      }
      let maxR = 1;
      for (const n of nodes) {
        if (n.id !== dragRef.current) {
          n.vx *= 0.8;
          n.vy *= 0.8;
          n.x += n.vx;
          n.y += n.vy;
        }
        const r = Math.sqrt(n.x * n.x + n.y * n.y);
        if (r > maxR) maxR = r;
      }

      // --- Auto-tilpass utsnittet til brukeren zoomer/panner selv. ---
      const view = viewRef.current;
      if (!view.user) {
        const fit = Math.min(w, h) / 2.3 / maxR;
        view.k += (Math.min(1.6, fit) - view.k) * 0.08;
        view.x += (w / 2 - view.x) * 0.15;
        view.y += (h / 2 - view.y) * 0.15;
      }

      // --- Tegning. ---
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.fillStyle = BG;
      ctx!.fillRect(0, 0, w, h);
      ctx!.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);
      ctx!.globalCompositeOperation = "lighter";

      const big = nodes.length > 400;
      ctx!.lineWidth = big ? 0.5 : 0.8;
      for (const e of data!.edges) {
        const ia = idx.get(e.from_id);
        const ib = idx.get(e.to_id);
        if (ia == null || ib == null) continue;
        const a = nodes[ia];
        const b = nodes[ib];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const t = Math.min(1, Math.sqrt(mx * mx + my * my) / maxR);
        ctx!.strokeStyle = edgeColor(t, big ? 0.28 : 0.45);
        // Svak, stabil bue gir det organiske nervetråd-uttrykket.
        const bend = (hash01(e.from_id + e.to_id) - 0.5) * 0.5;
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.quadraticCurveTo(
          mx - (b.y - a.y) * bend,
          my + (b.x - a.x) * bend,
          b.x,
          b.y
        );
        ctx!.stroke();
      }

      const hover = hoverRef.current;
      for (const n of nodes) {
        const doc = n.type === "dokument";
        const active = n.id === hover || n.id === selId;
        const r = (doc ? 3 : 2 + Math.min(2, n.deg * 0.4)) * (active ? 1.8 : 1);
        ctx!.fillStyle = doc ? NODE_DOC : NODE_MINT;
        ctx!.shadowColor = doc ? NODE_DOC : NODE_MINT;
        ctx!.shadowBlur = big ? 4 : 8;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.shadowBlur = 0;
      ctx!.globalCompositeOperation = "source-over";

      // Etikett for hover/valgt node — tegnes i skjermrom for jevn størrelse.
      const labelFor = hover ?? selId;
      if (labelFor) {
        const n = nodes[idx.get(labelFor) ?? -1];
        if (n) {
          ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
          const sx = n.x * view.k + view.x;
          const sy = n.y * view.k + view.y;
          ctx!.font = "12px system-ui, sans-serif";
          ctx!.fillStyle = "rgba(232,232,228,0.92)";
          ctx!.fillText(n.title, sx + 10, sy + 4);
        }
      }

      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [data, selId]);

  function toWorld(e: React.MouseEvent): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    const view = viewRef.current;
    return {
      x: (e.clientX - rect.left - view.x) / view.k,
      y: (e.clientY - rect.top - view.y) / view.k,
    };
  }

  function nodeAt(p: { x: number; y: number }): Sim | null {
    const hitR = 9 / viewRef.current.k;
    let best: Sim | null = null;
    let bestD = hitR * hitR;
    for (const n of simRef.current) {
      const dx = n.x - p.x;
      const dy = n.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        best = n;
      }
    }
    return best;
  }

  function onDown(e: React.MouseEvent) {
    const hit = nodeAt(toWorld(e));
    movedRef.current = false;
    if (hit) {
      dragRef.current = hit.id;
    } else {
      panRef.current = { x: e.clientX, y: e.clientY };
    }
  }

  function onMove(e: React.MouseEvent) {
    const p = toWorld(e);
    mouseRef.current = p;
    if (dragRef.current) {
      movedRef.current = true;
      const n = simRef.current.find((s) => s.id === dragRef.current);
      if (n) {
        n.x = p.x;
        n.y = p.y;
        n.vx = 0;
        n.vy = 0;
      }
      return;
    }
    if (panRef.current) {
      movedRef.current = true;
      viewRef.current.user = true;
      viewRef.current.x += e.clientX - panRef.current.x;
      viewRef.current.y += e.clientY - panRef.current.y;
      panRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    hoverRef.current = nodeAt(p)?.id ?? null;
  }

  function onUp(e: React.MouseEvent) {
    const wasDrag = dragRef.current;
    dragRef.current = null;
    panRef.current = null;
    if (wasDrag && !movedRef.current) {
      const rect = canvasRef.current!.getBoundingClientRect();
      setSelId(wasDrag);
      setCardPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    } else if (!wasDrag && !movedRef.current) {
      setSelId(null);
    }
  }

  function onWheel(e: React.WheelEvent) {
    const view = viewRef.current;
    view.user = true;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const k = Math.min(6, Math.max(0.15, view.k * factor));
    // Zoom rundt musepekeren: punktet under pekeren står stille.
    view.x = mx - ((mx - view.x) / view.k) * k;
    view.y = my - ((my - view.y) / view.k) * k;
    view.k = k;
  }

  if (!data) return null;
  if (data.nodes.length === 0) {
    return <div className={styles.empty}>Ingen godkjente noder ennå.</div>;
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={() => {
          dragRef.current = null;
          panRef.current = null;
          hoverRef.current = null;
        }}
        onWheel={onWheel}
      />
      {selected && cardPos && (
        <div
          className={styles.tooltipWrap}
          style={{ left: cardPos.x, top: cardPos.y }}
        >
          <textarea
            className={styles.tooltip}
            value={summary}
            autoFocus
            rows={3}
            onChange={(e) => setSummary(e.target.value)}
            onBlur={saveNode}
          />
          <div className={styles.tooltipFooter}>
            <button
              type="button"
              className={styles.tooltipDel}
              onMouseDown={(e) => {
                e.preventDefault();
                removeNode();
              }}
            >
              <HugeiconsIcon icon={Delete01Icon} size={14} />
              Slett
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
