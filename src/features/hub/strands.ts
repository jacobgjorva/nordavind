// Trådgrafen: hver agent er én horisontal tråd gjennom tiden, som i et
// baneskjema. X = tid («nå» ved høyre kant), y = trådens bane. Tråden ligger
// flat mens agenten sover, slår bølger rundt hver kjøring, og markerer svar
// som prikker — ulest svar lyser. Tråder i samme kategori buntes sammen.
import type { AgentInfo, AgentRunEvent } from "../../lib/api";
import { avatarColor } from "../../ui/avatar";

export const PAD_TOP = 56;
// Plass til tidslinjalen som ligger nederst på skjermen.
export const RULER_H = 62;
export const PAD_BOTTOM = RULER_H + 24;

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

// Tidsvindu: like mye bakover som frem — «nå» står i midten. Brukeren
// velger vidden (±1t, ±6t, ±12t, ±24t).
export const WINDOW_CHOICES = [1, 6, 12, 24] as const;

// timeToX mapper et tidspunkt inn i spennet for et gitt vindu (timer).
export function timeToX(ms: number, span: XSpan, now: number, hours: number): number {
  const half = hours * 3600 * 1000;
  return span.x0 + ((ms - (now - half)) / (half * 2)) * (span.x1 - span.x0);
}

// predictedRuns: forventede kjøretidspunkter i fremtidsvinduet, fra
// next_run_at og utover med agentens intervall. Pausede spår ingenting.
const predictCache = new Map<string, { ts: number; runs: number[] }>();

export function predictedRuns(a: AgentInfo, now: number, hours: number): number[] {
  if (!a.enabled || a.state === "paused" || !a.next_run_at || !a.interval_seconds) return [];
  // Cache per agent+vindu i 5 s — strandY kalles per sample, prediksjonen er dyr.
  const key = `${a.id}:${hours}`;
  const hit = predictCache.get(key);
  if (hit && now - hit.ts < 5000) return hit.runs;
  const out: number[] = [];
  let t = Date.parse(a.next_run_at);
  const end = now + hours * 3600 * 1000;
  while (t <= end && out.length < 200) {
    if (t > now) out.push(t);
    t += a.interval_seconds * 1000;
  }
  predictCache.set(key, { ts: now, runs: out });
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
  t: number,
  hours: number
): number {
  const phase = (hash(s.agent.id) % 628) / 100;
  let y = s.laneY;

  // Aktivitetskonvolutt: summer gaussene rundt hver kjøring (faktisk og
  // predikert) og legg ÉN felles bærebølge oppå. Med separate sinuser per
  // kjøring slo tette intervaller (15 min) hverandre i hjel — med felles
  // bærebølge forsterker de hverandre og tette planer vises som jevn aktivitet.
  let env = 0;
  for (const r of s.runs) {
    const d = x - timeToX(Date.parse(r.started_at), span, now, hours);
    env += Math.exp(-(d * d) / (2 * 8 * 8));
  }
  for (const ms of predictedRuns(s.agent, now, hours)) {
    const d = x - timeToX(ms, span, now, hours);
    env += Math.exp(-(d * d) / (2 * 8 * 8));
  }
  if (env > 0.02) {
    y += Math.sin(x * 0.38 + phase) * 5.5 * Math.min(1, env);
  }

  // Kjører akkurat nå: rullende bølge rundt nå-linja.
  const state = s.agent.state;
  if (state === "working" || state === "thinking") {
    const d = x - timeToX(now, span, now, hours);
    const env = Math.exp(-(d * d) / (2 * 34 * 34));
    y += Math.sin(x * 0.12 - t * 2.4 + phase) * 6 * env;
  }
  return y;
}
