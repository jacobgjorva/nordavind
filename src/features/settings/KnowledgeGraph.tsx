import { useEffect, useRef, useState } from "react";
import { swallow } from "../../lib/log";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete01Icon } from "@hugeicons/core-free-icons";
import {
  fetchKnowledgeGraph,
  updateNode,
  deleteNode,
  createEdge,
  removeEdge,
  confirmKnowledge,
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
  bucket: number; // fargetrinn 0..DEG_STEPS-1 fra koblingsgrad
  fade: number; // 0.45 for lapper som aldri hentes og er gamle, ellers 1
  scope: string; // synlighet: "" org | unit:* | user:* — ring-fargen
}

const HEIGHT = 440;

// Fargespråket: mørk flate, kanter i en lilla→rosa→krem-gradient (varmest mot
// sentrum), noder som små lyse mint-punkter med glød. Dokument-noder gull.
const BG = "#050507";
// Nodefargen følger koblingsgraden: få/ingen koblinger = mint (dagens grønne),
// mange koblinger = lilla. Interpolert i faste trinn (sprites).
const DEG_LOW: [number, number, number] = [141, 240, 198]; // mint
const DEG_HIGH: [number, number, number] = [160, 107, 240]; // lilla
const DEG_STEPS = 6;
function degMix(t: number): [number, number, number] {
  return [
    Math.round(DEG_LOW[0] + (DEG_HIGH[0] - DEG_LOW[0]) * t),
    Math.round(DEG_LOW[1] + (DEG_HIGH[1] - DEG_LOW[1]) * t),
    Math.round(DEG_LOW[2] + (DEG_HIGH[2] - DEG_LOW[2]) * t),
  ];
}
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
// fill: fyll forelderens høyde (/graf-siden) i stedet for panel-høyden.
export function KnowledgeGraph({ fill = false }: { fill?: boolean }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [title, setTitle] = useState("");
  // Editor-tilstand: søk, koble-modus og ny node-skjemaet.
  const [query, setQuery] = useState("");
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newType, setNewType] = useState("term");
  const [newTitle, setNewTitle] = useState("");
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<Sim[]>([]);
  const hoverRef = useRef<string | null>(null);
  const dragRef = useRef<string | null>(null);
  const movedRef = useRef(false);
  // Verdenstransform: sentrert i (0,0), auto-tilpasses til brukeren tar styring.
  const viewRef = useRef({ x: 0, y: 0, k: 1, user: false });
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  // Vekker den frosne rAF-løkka (heat > 0 varmer opp fysikken igjen).
  const wakeRef = useRef<(heat: number) => void>(() => {});
  // d3-aktig alphaTarget: holdes på 0.3 under dra så nabolaget følger
  // elastisk etter (Obsidian-følelsen); 0 ellers.
  const alphaTargetRef = useRef(0);
  const selRef = useRef<string | null>(null);
  // Naboskap (id → koblede id-er) for highlight/dim og panelets naboliste.
  const adjRef = useRef<Map<string, Set<string>>>(new Map());
  const linkFromRef = useRef<string | null>(null);
  // Fly-til-node: settes av søk/naboklikk, konsumeres i step().
  const flyRef = useRef<string | null>(null);

  const selected = data?.nodes.find((n) => n.id === selId) ?? null;
  useEffect(() => {
    selRef.current = selId;
    wakeRef.current(0);
  }, [selId]);

  useEffect(() => {
    if (selected) {
      setTitle(selected.title);
      setSummary(selected.summary);
    }
  }, [selId]);

  function saveNode() {
    const id = selId;
    if (!id) return;
    const t = title.trim();
    const s = summary.trim();
    if (!t || !s || (t === selected?.title && s === selected?.summary)) return;
    setData((d) =>
      d
        ? {
            ...d,
            nodes: d.nodes.map((n) =>
              n.id === id ? { ...n, title: t, summary: s } : n
            ),
          }
        : d
    );
    updateNode(id, t, s).catch(swallow);
  }

  // Søketreff: enkel innholdsmatch, maks 8.
  const matches =
    query.trim().length >= 2 && data
      ? data.nodes
          .filter((n) =>
            (n.title + " " + n.summary)
              .toLowerCase()
              .includes(query.trim().toLowerCase())
          )
          .slice(0, 8)
      : [];

  function flyTo(id: string) {
    setSelId(id);
    flyRef.current = id;
    wakeRef.current(0);
  }

  // Ny node: lagres via samme vei som klikk-bekreftelsen (accepted +
  // automatisk dublettvakt), og grafen flyr til den etterpå.
  async function createNewNode() {
    const t = newTitle.trim();
    const txt = newText.trim();
    if (!t || !txt || busy) return;
    setBusy(true);
    try {
      await confirmKnowledge({ type: newType, title: t, summary: txt });
      const fresh = await fetchKnowledgeGraph();
      setData(fresh);
      setNewOpen(false);
      setNewTitle("");
      setNewText("");
      const created = fresh.nodes.find((n) => n.title === t);
      if (created) flyTo(created.id);
    } catch {
      /* vis-i-ro: brukeren kan prøve igjen */
    } finally {
      setBusy(false);
    }
  }

  // Panelets naboliste (id + tittel + relasjon), fra rådataene.
  const neighborRows = !selId || !data
    ? []
    : data.edges
        .filter((e) => e.from_id === selId || e.to_id === selId)
        .map((e) => {
          const otherID = e.from_id === selId ? e.to_id : e.from_id;
          const other = data.nodes.find((n) => n.id === otherID);
          return other ? { edge: e, id: otherID, title: other.title, relation: e.relation } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

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

  const refetch = () =>
    fetchKnowledgeGraph()
      .then(setData)
      .catch(() => setData({ nodes: [], edges: [] }));
  useEffect(() => {
    refetch();
  }, []);

  useEffect(() => {
    linkFromRef.current = linkFrom;
  }, [linkFrom]);

  // Esc: ut av koble-modus, lukk panel/skjema.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setLinkFrom(null);
        setNewOpen(false);
        setSelId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Init: noder spres i en spiral rundt origo; grad beregnes for størrelse.
  useEffect(() => {
    if (!data) return;
    const deg = new Map<string, number>();
    for (const e of data.edges) {
      deg.set(e.from_id, (deg.get(e.from_id) ?? 0) + 1);
      deg.set(e.to_id, (deg.get(e.to_id) ?? 0) + 1);
    }
    let maxDeg = 1;
    for (const d of deg.values()) {
      if (d > maxDeg) maxDeg = d;
    }
    const adj = new Map<string, Set<string>>();
    for (const e of data.edges) {
      if (!adj.has(e.from_id)) adj.set(e.from_id, new Set());
      if (!adj.has(e.to_id)) adj.set(e.to_id, new Set());
      adj.get(e.from_id)!.add(e.to_id);
      adj.get(e.to_id)!.add(e.from_id);
    }
    adjRef.current = adj;
    // Refetch etter redigering skal ikke kaste om hele layouten: behold
    // posisjonen til noder som alt ligger i simuleringen.
    const prev = new Map(simRef.current.map((n) => [n.id, n]));
    const twoWeeks = 14 * 24 * 3600 * 1000;
    simRef.current = data.nodes.map((node, i) => {
      const a = i * 2.399963; // gullvinkel — jevn spiral uansett antall
      const r = 14 * Math.sqrt(i + 1);
      const dg = deg.get(node.id) ?? 0;
      // Kvadratrot løfter mellomsjiktet — ellers blir alt unntatt hubene mint.
      const t = Math.sqrt(dg / maxDeg);
      const old = prev.get(node.id);
      // Falming: aldri hentet OG eldre enn to uker → dimmes (selvkuraterende
      // kvalitet — kandidater for opprydding).
      const stale =
        node.hits === 0 &&
        Date.now() - new Date(node.created_at).getTime() > twoWeeks;
      return {
        id: node.id,
        title: node.title,
        type: node.type,
        x: old ? old.x : Math.cos(a) * r,
        y: old ? old.y : Math.sin(a) * r,
        vx: 0,
        vy: 0,
        deg: dg,
        bucket: Math.min(DEG_STEPS - 1, Math.round(t * (DEG_STEPS - 1))),
        fade: stale ? 0.45 : 1,
        scope: n.scope ?? "",
      };
    });
    if (prev.size === 0) viewRef.current.user = false;
  }, [data]);

  // Simulering + tegning i samme rAF-løkke — React røres aldri per frame.
  // Nedkjøling: kreftene skaleres med en alfa som dør ut; når grafen har satt
  // seg STOPPER løkka helt (null CPU i ro) og vekkes av interaksjon.
  useEffect(() => {
    if (!data) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let alpha = 1;
    const alphaDecay = 0.028; // eksponentiell, som d3-force
    const alphaMin = 0.002;
    const dpr = window.devicePixelRatio || 1;

    // Glød-sprites: radial gradient rendret ÉN gang per farge — shadowBlur på
    // hver node hver frame var det som spiste GPU-en.
    function makeSprite(color: string): HTMLCanvasElement {
      const s = document.createElement("canvas");
      s.width = s.height = 64;
      const c = s.getContext("2d")!;
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, color);
      g.addColorStop(0.25, color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
      return s;
    }
    const sprites: HTMLCanvasElement[] = [];
    const cores: string[] = [];
    for (let i = 0; i < DEG_STEPS; i++) {
      const [r, g, b] = degMix(i / (DEG_STEPS - 1));
      sprites.push(makeSprite(`rgb(${r},${g},${b})`));
      // Kjernen er en lysere utgave av glødfargen — de skarpe punktene.
      cores.push(`rgb(${Math.min(255, r + 70)},${Math.min(255, g + 70)},${Math.min(255, b + 70)})`);
    }

    function step() {
      const nodes = simRef.current;
      const w = wrap!.clientWidth;
      const h = fill ? wrap!.clientHeight : HEIGHT;
      if (canvas!.width !== w * dpr || canvas!.height !== h * dpr) {
        canvas!.width = w * dpr;
        canvas!.height = h * dpr;
        canvas!.style.height = `${h}px`;
      }

      // --- Krefter. Frastøtning via romlig rutenett: O(n · naboceller). ---
      const cell = 150;
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
              if (d2 > cell * cell * 9) continue;
              const f = (1600 / d2) * alpha;
              const d = Math.sqrt(d2);
              a.vx += (dx / d) * f;
              a.vy += (dy / d) * f;
            }
          }
        }
        // Sentrering mot origo — svakere for hub-noder så de får bre seg.
        a.vx += -a.x * 0.0015 * alpha;
        a.vy += -a.y * 0.0015 * alpha;
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
        const degA = a.deg || 1;
        const degB = b.deg || 1;
        const strength = 1 / Math.min(degA, degB);
        const l = ((d - 60) / d) * alpha * strength;
        const bias = degA / (degA + degB);
        if (b.id !== dragRef.current) {
          b.vx -= dx * l * bias;
          b.vy -= dy * l * bias;
        }
        if (a.id !== dragRef.current) {
          a.vx += dx * l * (1 - bias);
          a.vy += dy * l * (1 - bias);
        }
      }
      let maxR = 1;
      for (const n of nodes) {
        if (n.id !== dragRef.current) {
          n.vx *= 0.6;
          n.vy *= 0.6;
          // Sikkerhetsventil mot eksplosjoner, aldri i normal drift.
          const v = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
          if (v > 30) {
            n.vx = (n.vx / v) * 30;
            n.vy = (n.vy / v) * 30;
          }
          n.x += n.vx;
          n.y += n.vy;
        }
        const r = Math.sqrt(n.x * n.x + n.y * n.y);
        if (r > maxR) maxR = r;
      }
      alpha += (alphaTargetRef.current - alpha) * alphaDecay;

      // --- Fly-til (søk/naboklikk): glid mot noden, zoom lett inn. ---
      const view = viewRef.current;
      if (flyRef.current) {
        const target = nodes[idx.get(flyRef.current) ?? -1];
        if (!target) {
          flyRef.current = null;
        } else {
          view.user = true;
          const k = Math.max(view.k, 1.3);
          const tx = w / 2 - target.x * k;
          const ty = h / 2 - target.y * k;
          view.k += (k - view.k) * 0.14;
          view.x += (tx - view.x) * 0.14;
          view.y += (ty - view.y) * 0.14;
          if (Math.abs(tx - view.x) < 2 && Math.abs(ty - view.y) < 2) {
            flyRef.current = null;
          }
        }
      }
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

      const big = nodes.length > 900;
      // Fokus: hover/valgt node løfter sitt nabolag — resten dimmes.
      const focus = hoverRef.current ?? selRef.current;
      const focusSet = focus ? adjRef.current.get(focus) : null;
      // Konstant strektykkelse på SKJERMEN uansett zoom — kantene er selve
      // uttrykket og skal aldri forsvinne ved utzooming.
      ctx!.lineWidth = (big ? 0.9 : 1.3) / view.k;
      for (const e of data!.edges) {
        const ia = idx.get(e.from_id);
        const ib = idx.get(e.to_id);
        if (ia == null || ib == null) continue;
        const a = nodes[ia];
        const b = nodes[ib];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const t = Math.min(1, Math.sqrt(mx * mx + my * my) / maxR);
        let ea = big ? 0.4 : 0.62;
        if (focus) {
          ea = e.from_id === focus || e.to_id === focus ? 0.95 : 0.1;
        }
        ctx!.strokeStyle = edgeColor(t, ea);
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
      const sel = selRef.current;
      for (const n of nodes) {
        const active = n.id === hover || n.id === sel;
        const inFocus =
          !focus || n.id === focus || (focusSet ? focusSet.has(n.id) : false);
        const r = (2 + Math.min(2.5, n.deg * 0.3)) * (active ? 1.8 : 1);
        const g = r * 4.5;
        ctx!.globalAlpha = (inFocus ? 1 : 0.14) * n.fade;
        ctx!.drawImage(sprites[n.bucket], n.x - g, n.y - g, g * 2, g * 2);
        // Liten solid kjerne over gløden gir de skarpe lyspunktene.
        ctx!.fillStyle = cores[n.bucket];
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, r * 0.7, 0, Math.PI * 2);
        ctx!.fill();
        // Synlighets-ring: grønn = enhet, gul = privat, ingen = hele org.
        if (n.scope) {
          ctx!.strokeStyle = n.scope.startsWith("user:")
            ? "rgba(240, 200, 90, 0.9)"
            : "rgba(110, 220, 140, 0.9)";
          ctx!.lineWidth = 1.2;
          ctx!.beginPath();
          ctx!.arc(n.x, n.y, r * 1.5, 0, Math.PI * 2);
          ctx!.stroke();
        }
      }
      ctx!.globalAlpha = 1;
      ctx!.globalCompositeOperation = "source-over";

      // Etikett for hover/valgt node — tegnes i skjermrom for jevn størrelse.
      const labelFor = hover ?? sel;
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

      // Frossen og i ro: stopp løkka helt. Interaksjoner vekker den igjen.
      if (alpha > alphaMin || alphaTargetRef.current > 0 || dragRef.current || flyRef.current) {
        raf = requestAnimationFrame(step);
      } else {
        running = false;
      }
    }

    let running = true;
    wakeRef.current = (heat: number) => {
      alpha = Math.max(alpha, heat);
      if (!running) {
        running = true;
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      wakeRef.current = () => {};
    };
  }, [data]);

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
      alphaTargetRef.current = 0.3;
      wakeRef.current(0.3);
    }
    // Bakgrunnen er fast: grafen flyttes aldri, kun noder (og zoom).
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
    const prev = hoverRef.current;
    hoverRef.current = nodeAt(p)?.id ?? null;
    if (hoverRef.current !== prev) wakeRef.current(0);
  }

  function onUp() {
    const wasDrag = dragRef.current;
    dragRef.current = null;
    alphaTargetRef.current = 0;
    if (wasDrag && !movedRef.current) {
      // Koble-modus: klikket node blir målet for den nye kanten.
      const from = linkFromRef.current;
      if (from && from !== wasDrag) {
        setLinkFrom(null);
        createEdge({ from_id: from, to_id: wasDrag, relation: "relatert til" })
          .then(refetch)
          .catch(swallow);
        return;
      }
      setSelId(wasDrag);
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
    wakeRef.current(0);
  }

  if (!data) return null;
  if (data.nodes.length === 0) {
    return <div className={styles.empty}>Ingen godkjente noder ennå.</div>;
  }

  return (
    <div className={fill ? styles.wrapFill : styles.wrap} ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={() => {
          dragRef.current = null;
          hoverRef.current = null;
          alphaTargetRef.current = 0;
        }}
        onWheel={onWheel}
      />
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          placeholder="Søk i kunnskapen …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches.length > 0) {
              flyTo(matches[0].id);
              setQuery("");
            }
          }}
        />
        {matches.length > 0 && (
          <div className={styles.searchResults}>
            {matches.map((m) => (
              <button
                key={m.id}
                className={styles.searchHit}
                onClick={() => {
                  flyTo(m.id);
                  setQuery("");
                }}
              >
                <span className={styles.searchHitTitle}>{m.title}</span>
                <span className={styles.searchHitText}>{m.summary}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button className={styles.newBtn} onClick={() => setNewOpen((v) => !v)}>
        Ny node
      </button>
      {newOpen && (
        <div className={styles.newForm}>
          <select
            className={styles.newSelect}
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
          >
            <option value="term">term</option>
            <option value="prosess">prosess</option>
            <option value="regel">regel</option>
            <option value="entitet">entitet</option>
          </select>
          <input
            className={styles.newInput}
            placeholder="Kort tittel"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <textarea
            className={styles.newTextarea}
            placeholder="Selve kunnskapen — én presis, selvstendig setning eller to"
            rows={3}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
          />
          <button
            className={styles.newSave}
            disabled={busy || !newTitle.trim() || !newText.trim()}
            onClick={createNewNode}
          >
            Lagre
          </button>
        </div>
      )}

      {linkFrom && (
        <div className={styles.linkHint}>
          Klikk noden du vil koble til — Esc avbryter
        </div>
      )}

      {selected && (
        <div className={styles.panel}>
          <div className={styles.panelTop}>
            <span className={styles.panelType}>{selected.type}</span>
            <button className={styles.panelClose} onClick={() => setSelId(null)}>
              ×
            </button>
          </div>
          <input
            className={styles.panelInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveNode}
          />
          <textarea
            className={styles.panelTextarea}
            rows={5}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onBlur={saveNode}
          />
          <div className={styles.panelMeta}>
            {selected.hits > 0
              ? `Hentet ${selected.hits} ganger${selected.last_hit_at ? `, sist ${new Date(selected.last_hit_at).toLocaleDateString("nb-NO")}` : ""}`
              : "Aldri hentet ennå"}
            {" — "}
            lagt til {new Date(selected.created_at).toLocaleDateString("nb-NO")}
            {" — "}
            {selected.scope
              ? selected.scope.startsWith("user:")
                ? "privat"
                : "delt i enhet"
              : "hele organisasjonen"}
          </div>
          {neighborRows.length > 0 && (
            <div className={styles.neighbors}>
              {neighborRows.map((n) => (
                <div key={n.id + n.relation} className={styles.neighborRow}>
                  <button
                    className={styles.neighborLink}
                    onClick={() => flyTo(n.id)}
                  >
                    {n.title}
                  </button>
                  <span className={styles.neighborRel}>{n.relation}</span>
                  <button
                    className={styles.neighborDel}
                    title="Fjern koblingen"
                    onClick={() =>
                      removeEdge(n.edge).then(refetch).catch(swallow)
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className={styles.panelActions}>
            <button
              className={styles.panelDelete}
              onClick={() => setLinkFrom(selId)}
            >
              Koble
            </button>
            <button className={styles.panelDelete} onClick={removeNode}>
              <HugeiconsIcon icon={Delete01Icon} size={14} />
              Slett
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
