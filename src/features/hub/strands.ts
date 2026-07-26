// Trådgrafen: hver agent er én horisontal tråd gjennom tiden, som i et
// baneskjema. X = tid («nå» ved høyre kant), y = trådens bane. Tråden ligger
// flat mens agenten sover, slår bølger rundt hver kjøring, og markerer svar
// som prikker — ulest svar lyser. Tråder i samme kategori buntes sammen.
import type { AgentInfo, AgentRunEvent } from "../../lib/api";
import { avatarColor } from "../../ui/avatar";

export const PAD_X = 140; // plass til navn ved venstre kant
export const PAD_TOP = 64;
export const PAD_BOTTOM = 32;

export interface Strand {
  agent: AgentInfo;
  laneY: number; // trådens hvileposisjon
  color: string;
  runs: AgentRunEvent[];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function categoryColor(category: string, fallback: string): [string, string] {
  return avatarColor((category || fallback).toLowerCase());
}

// layoutStrands: buntede baner — gruppér per kategori (ukategorisert sist),
// innad i gruppa eldste øverst; luft mellom buntene.
export function layoutStrands(
  agents: AgentInfo[],
  runs: AgentRunEvent[],
  height: number
): Strand[] {
  const byAgent = new Map<string, AgentRunEvent[]>();
  for (const r of runs) {
    const list = byAgent.get(r.agent_id) ?? [];
    list.push(r);
    byAgent.set(r.agent_id, list);
  }

  const groups = new Map<string, AgentInfo[]>();
  for (const a of agents) {
    const key = a.category || "￿"; // ukategorisert sorteres sist
    const list = groups.get(key) ?? [];
    list.push(a);
    groups.set(key, list);
  }
  const keys = [...groups.keys()].sort();
  for (const k of keys) {
    groups.get(k)!.sort(
      (a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? "")
    );
  }

  const laneGap = 26;
  const groupGap = 34;
  const totalLanes = agents.length;
  const totalHeight =
    totalLanes * laneGap + Math.max(0, keys.length - 1) * groupGap;
  const available = height - PAD_TOP - PAD_BOTTOM;
  // Krymp avstandene ved mange agenter i stedet for å gå utenfor lerretet.
  const scale = totalHeight > available ? available / totalHeight : 1;
  let y = PAD_TOP + Math.max(0, (available - totalHeight) / 2);

  const strands: Strand[] = [];
  for (const k of keys) {
    for (const a of groups.get(k)!) {
      strands.push({
        agent: a,
        laneY: y,
        color: categoryColor(a.category ?? "", a.name)[0],
        runs: byAgent.get(a.id) ?? [],
      });
      y += laneGap * scale;
    }
    y += groupGap * scale;
  }
  return strands;
}

// strandY: trådens y ved en gitt x — flat bane pluss bølger rundt kjøringene
// og en levende bølge i høyrekanten når agenten kjører akkurat nå.
export function strandY(
  s: Strand,
  x: number,
  width: number,
  windowMs: number,
  now: number,
  t: number
): number {
  const timeAt = (px: number) =>
    now - windowMs + ((px - PAD_X) / (width - PAD_X - 24)) * windowMs;
  const phase = (hash(s.agent.id) % 628) / 100;
  let y = s.laneY;

  // Bølgepakke rundt hver kjøring: gaussisk konvolutt over en LAV frekvens —
  // lange, myke svulmer, ikke pigger.
  for (const r of s.runs) {
    const runX =
      PAD_X + ((Date.parse(r.started_at) - (now - windowMs)) / windowMs) * (width - PAD_X - 24);
    const d = x - runX;
    const env = Math.exp(-(d * d) / (2 * 26 * 26));
    if (env > 0.01) y += Math.sin(d * 0.14 + phase) * 8 * env;
  }

  // Kjører akkurat nå: rolig rullende bølge ved høyrekanten.
  const state = s.agent.state;
  if (state === "working" || state === "thinking") {
    const d = x - (width - 24);
    const env = Math.exp(-(d * d) / (2 * 48 * 48));
    y += Math.sin(x * 0.09 - t * 2.4 + phase) * 7 * env;
  }
  void timeAt;
  return y;
}
