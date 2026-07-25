// Agent-grafen, tre seksjoner delt av to vertikale linjer:
//
//   venter                | kjører      | svar
//   x = tid til neste     | pulserer nå | resultat klart, ulest
//   kjøring, y = alder    |             |
//
// Venstre er en tidslinje: en node helt til venstre begynte akkurat på
// søvnen sin, en node inntil linja er i ferd med å våkne. Y-aksen er alder:
// nye agenter øverst, de eldste nederst. Høyresiden er løst spredt.
// Nodene glir mot målpunktet med fjær + svak drift — ingen hard hopping.
import type { AgentInfo, AgentState } from "../../lib/api";
import { avatarColor } from "../../ui/avatar";

// Seksjonsgrenser som andel av bredden.
export const DIVIDE_LEFT = 0.41;
export const DIVIDE_RIGHT = 0.59;
const PAD = 60; // luft mot kantene

export interface Node {
  agent: AgentInfo;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  pulse: number; // 0..1, opp når agenten kjører (tegnes som puls)
  phase: number;
  jitterX: number; // stabil personlig spredning
  jitterY: number;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// categoryColor: stabil farge fra den delte avatar-paletten. Kategorien
// styrer fargen; uten kategori farges noden av sitt eget navn.
export function categoryColor(category: string, fallback: string): [string, string] {
  return avatarColor((category || fallback).toLowerCase());
}

// sleepProgress: 0 = la seg akkurat, 1 = våkner nå. Regnes fra next_run_at
// bakover med intervallet, klemt til [0,1] så drift i klokker ikke velter noe.
function sleepProgress(a: AgentInfo, now: number): number {
  if (!a.next_run_at || !a.interval_seconds) return 0.5;
  const next = Date.parse(a.next_run_at);
  const left = (next - now) / 1000;
  return Math.min(1, Math.max(0, 1 - left / a.interval_seconds));
}

export class GraphSim {
  nodes: Node[] = [];
  width = 800;
  height = 600;

  sync(agents: AgentInfo[]) {
    const byId = new Map(this.nodes.map((n) => [n.agent.id, n]));
    this.nodes = agents.map((agent) => {
      const existing = byId.get(agent.id);
      if (existing) {
        existing.agent = agent;
        return existing;
      }
      const h = hash(agent.id);
      return {
        agent,
        // Fødes utenfor venstre kant og glir inn.
        x: -30,
        y: this.height / 2,
        vx: 0,
        vy: 0,
        r: 14,
        pulse: 0,
        phase: (h % 628) / 100,
        jitterX: (((h >> 4) % 100) - 50) / 100, // -0.5..0.5
        jitterY: (((h >> 12) % 100) - 50) / 100,
      };
    });
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  // ageY: y-posisjon fra alders-RANGERING blant alle agentene — nyeste øverst,
  // eldste nederst. Rangering (ikke absolutt tid) gir jevn spredning uansett
  // om agentene ble laget samme uke eller over to år.
  private ageY(agent: AgentInfo): number {
    const sorted = [...this.nodes].sort(
      (a, b) => Date.parse(b.agent.created_at ?? "") - Date.parse(a.agent.created_at ?? "")
    );
    const idx = sorted.findIndex((n) => n.agent.id === agent.id);
    const t = sorted.length > 1 ? idx / (sorted.length - 1) : 0.5;
    return PAD + t * (this.height - PAD * 2);
  }

  // target: hvor noden hører hjemme akkurat nå.
  private target(n: Node, now: number): { x: number; y: number; running: boolean } {
    const a = n.agent;
    const state: AgentState = a.state ?? "sleeping";
    const running = state === "working" || state === "thinking";
    const y = this.ageY(a);
    const jitterAmp = 26;

    if (running) {
      // Midtfeltet: kjører akkurat nå.
      const cx = this.width * (DIVIDE_LEFT + DIVIDE_RIGHT) / 2;
      return { x: cx + n.jitterX * (this.width * (DIVIDE_RIGHT - DIVIDE_LEFT) * 0.5), y, running };
    }
    if (a.has_response) {
      // Svar-seksjonen: løst spredt.
      const x0 = this.width * DIVIDE_RIGHT + 30;
      const x1 = this.width - PAD;
      const t = ((hash(a.id) >> 6) % 1000) / 1000;
      return { x: x0 + t * (x1 - x0), y: y + n.jitterY * jitterAmp * 2, running };
    }
    // Venter: tidslinja frem mot neste kjøring.
    const x0 = PAD;
    const x1 = this.width * DIVIDE_LEFT - 30;
    const p = sleepProgress(a, now);
    return { x: x0 + p * (x1 - x0), y: y + n.jitterY * jitterAmp, running };
  }

  step(dt: number, t: number, now: number) {
    const k = Math.min(dt, 0.05);
    for (const n of this.nodes) {
      const goal = this.target(n, now);
      n.vx += (goal.x - n.x) * 2.2 * k;
      n.vy += (goal.y - n.y) * 2.2 * k;
      // Svak drift så bildet lever.
      n.vx += Math.sin(t * 0.5 + n.phase) * 1.6 * k;
      n.vy += Math.cos(t * 0.4 + n.phase * 1.3) * 1.6 * k;
      n.pulse += ((goal.running ? 1 : 0) - n.pulse) * Math.min(1, 3 * k);
    }
    // Lett frastøtning så noder ikke dekker hverandre.
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = (a.r + b.r) * 1.6;
        if (d2 < min * min && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * 10 * k;
          a.vx -= dx * push;
          a.vy -= dy * push;
          b.vx += dx * push;
          b.vy += dy * push;
        }
      }
    }
    for (const n of this.nodes) {
      n.vx *= 0.85;
      n.vy *= 0.85;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  pick(x: number, y: number): Node | null {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      const r = n.r + 6;
      if ((x - n.x) ** 2 + (y - n.y) ** 2 <= r * r) return n;
    }
    return null;
  }
}
