// Kraftsimulering for agent-grafen: hver agent er en node som trekkes mot
// klyngeankeret til kategorien sin, dyttes fra naboene, og driver svakt så
// bildet lever. Ren Canvas 2D og egen fysikk — ingen avhengigheter, O(n²)
// frastøtning er helt fint opp til noen hundre agenter.
import type { AgentInfo, AgentState } from "../../lib/api";

export interface Node {
  agent: AgentInfo;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number; // grunnradius
  depth: number; // 0 = bakerst (sover), 1 = forrest (jobber); glir mot mål
  phase: number; // individuell fase så driften ikke er synkron
}

// hash gir stabile tall fra strenger (posisjon, fase, farge).
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// depthTarget: hvor langt frem i bildet tilstanden hører hjemme.
const DEPTH: Record<AgentState, number> = {
  working: 1,
  thinking: 0.8,
  broken: 0.65,
  paused: 0.3,
  sleeping: 0.1,
};

// categoryColor: stabil, behagelig HSL-farge per kategori. Ukategorisert er
// nøytralt grå-blå.
export function categoryColor(category: string): { h: number; s: number; l: number } {
  if (!category) return { h: 220, s: 12, l: 60 };
  const h = hash(category.toLowerCase()) % 360;
  return { h, s: 55, l: 62 };
}

export class GraphSim {
  nodes: Node[] = [];
  private anchors = new Map<string, { x: number; y: number }>();
  width = 800;
  height = 600;

  // sync speiler agentlisten inn i simuleringen uten å nullstille fysikken.
  sync(agents: AgentInfo[]) {
    const byId = new Map(this.nodes.map((n) => [n.agent.id, n]));
    this.nodes = agents.map((agent) => {
      const existing = byId.get(agent.id);
      if (existing) {
        existing.agent = agent;
        return existing;
      }
      const h = hash(agent.id);
      // Fødes nær sitt fremtidige anker, med litt spredning.
      return {
        agent,
        x: this.width / 2 + ((h % 200) - 100),
        y: this.height / 2 + (((h >> 8) % 200) - 100),
        vx: 0,
        vy: 0,
        r: 26,
        depth: 0.5,
        phase: (h % 628) / 100,
      };
    });
    this.layoutAnchors();
  }

  // layoutAnchors plasserer én klynge per kategori i en ring rundt midten;
  // ukategoriserte samles i sentrum. Én kategori alene ligger også i sentrum.
  private layoutAnchors() {
    const categories = [...new Set(this.nodes.map((n) => n.agent.category ?? ""))].sort();
    this.anchors.clear();
    const cx = this.width / 2;
    const cy = this.height / 2;
    const named = categories.filter((c) => c !== "");
    const ringR = Math.min(this.width, this.height) * (named.length > 1 ? 0.28 : 0);
    named.forEach((cat, i) => {
      const a = (i / named.length) * Math.PI * 2 - Math.PI / 2;
      this.anchors.set(cat, { x: cx + Math.cos(a) * ringR, y: cy + Math.sin(a) * ringR });
    });
    // Ukategorisert: i sentrum når det er plass, ellers under klyngeringen.
    this.anchors.set("", named.length > 1 ? { x: cx, y: cy + ringR * 1.6 } : { x: cx, y: cy });
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.layoutAnchors();
  }

  // step kjører ett fysikksteg. t brukes til den svake driften.
  step(dt: number, t: number) {
    const k = Math.min(dt, 0.05);
    for (const n of this.nodes) {
      const anchor = this.anchors.get(n.agent.category ?? "") ?? {
        x: this.width / 2,
        y: this.height / 2,
      };
      // Fjærkraft mot klyngeankeret.
      n.vx += (anchor.x - n.x) * 1.2 * k;
      n.vy += (anchor.y - n.y) * 1.2 * k;
      // Svak organisk drift.
      n.vx += Math.sin(t * 0.5 + n.phase) * 2.4 * k;
      n.vy += Math.cos(t * 0.4 + n.phase * 1.3) * 2.4 * k;
      // Dybden glir mot tilstandens mål.
      n.depth += ((DEPTH[n.agent.state ?? "sleeping"] ?? 0.5) - n.depth) * Math.min(1, 2.5 * k);
    }
    // Parvis frastøtning så klyngen brer seg ut i stedet for å kollapse.
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = (a.r + b.r) * 1.5;
        if (d2 < min * min && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * 14 * k;
          a.vx -= dx * push;
          a.vy -= dy * push;
          b.vx += dx * push;
          b.vy += dy * push;
        }
      }
    }
    for (const n of this.nodes) {
      n.vx *= 0.86; // demping — rolig, flytende bevegelse
      n.vy *= 0.86;
      n.x += n.vx;
      n.y += n.vy;
    }
    // Bakerste tegnes først: sorter mot dybde (stabil nok frame til frame).
    this.nodes.sort((a, b) => a.depth - b.depth);
  }

  // pick returnerer noden under punktet (fremste først).
  pick(x: number, y: number): Node | null {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      const r = n.r * (0.7 + n.depth * 0.5);
      if ((x - n.x) ** 2 + (y - n.y) ** 2 <= r * r) return n;
    }
    return null;
  }
}
