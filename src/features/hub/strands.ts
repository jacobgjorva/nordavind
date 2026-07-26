// Trådgrafen: hver agent er én horisontal tråd gjennom tiden, som i et
// baneskjema. X = tid («nå» ved høyre kant), y = trådens bane. Tråden ligger
// flat mens agenten sover, slår bølger rundt hver kjøring, og markerer svar
// som prikker — ulest svar lyser. Tråder i samme kategori buntes sammen.
import type { AgentInfo, AgentRunEvent } from "../../lib/api";
import { avatarColor } from "../../ui/avatar";

export const PAD_TOP = 64;
export const PAD_BOTTOM = 32;

// XSpan er grafens horisontale utstrekning — en sentrert kolonne, ikke full
// bredde. Navnene står rett til venstre for x0.
export interface XSpan {
  x0: number;
  x1: number;
}

export function computeSpan(width: number): XSpan {
  const maxContent = 980;
  const nameGutter = 130;
  const margin = Math.max(32, (width - maxContent - nameGutter) / 2);
  const x0 = margin + nameGutter;
  // Smale vinduer: sørg for at spennet aldri kollapser eller snur.
  return { x0, x1: Math.max(x0 + 120, width - margin) };
}

// Tidsvindu: 24 timer bakover og 24 timer frem — «nå» står i midten.
export const PAST_MS = 24 * 3600 * 1000;
export const FUTURE_MS = 24 * 3600 * 1000;

// timeToX mapper et tidspunkt inn i spennet.
export function timeToX(ms: number, span: XSpan, now: number): number {
  return span.x0 + ((ms - (now - PAST_MS)) / (PAST_MS + FUTURE_MS)) * (span.x1 - span.x0);
}

// predictedRuns: forventede kjøretidspunkter i fremtidsvinduet, fra
// next_run_at og utover med agentens intervall. Pausede spår ingenting.
export function predictedRuns(a: AgentInfo, now: number): number[] {
  if (!a.enabled || a.state === "paused" || !a.next_run_at || !a.interval_seconds) return [];
  const out: number[] = [];
  let t = Date.parse(a.next_run_at);
  const end = now + FUTURE_MS;
  while (t <= end && out.length < 60) {
    if (t > now) out.push(t);
    t += a.interval_seconds * 1000;
  }
  return out;
}

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
    // Kun kjøringer der agenten faktisk jobbet lager bølger — hoppet over
    // (token-grense) og feilede kjøringer skal ikke se ut som arbeid.
    if (r.status !== "ok" && r.status !== "unchanged") continue;
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

// strandY: trådens y ved en gitt x — flat bane pluss en kort, myk krusning
// rundt hver kjøring (en kjøring varer minutter, så avtrykket i et
// døgnvindu skal være smalt) og en rullende bølge ytterst når den kjører nå.
export function strandY(
  s: Strand,
  x: number,
  span: XSpan,
  now: number,
  t: number
): number {
  const phase = (hash(s.agent.id) % 628) / 100;
  let y = s.laneY;

  // Krusning per faktisk kjøring.
  for (const r of s.runs) {
    const runX = timeToX(Date.parse(r.started_at), span, now);
    const d = x - runX;
    const env = Math.exp(-(d * d) / (2 * 8 * 8));
    if (env > 0.02) y += Math.sin(d * 0.38 + phase) * 5.5 * env;
  }

  // Samme krusning for predikerte kjøringer i fremtidsdelen.
  for (const ms of predictedRuns(s.agent, now)) {
    const runX = timeToX(ms, span, now);
    const d = x - runX;
    const env = Math.exp(-(d * d) / (2 * 8 * 8));
    if (env > 0.02) y += Math.sin(d * 0.38 + phase) * 5.5 * env;
  }

  // Kjører akkurat nå: rullende bølge rundt nå-linja.
  const state = s.agent.state;
  if (state === "working" || state === "thinking") {
    const d = x - timeToX(now, span, now);
    const env = Math.exp(-(d * d) / (2 * 34 * 34));
    y += Math.sin(x * 0.12 - t * 2.4 + phase) * 6 * env;
  }
  return y;
}
