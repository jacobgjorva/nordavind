import { apiFetch, ApiError } from "./client";

export interface AgentConnection {
  id: string;
  name: string;
  driver: string;
}

// Tilkoblingene agent-widgeten lar brukeren velge mellom.
export async function fetchAgentConnections(): Promise<AgentConnection[]> {
  const data = await apiFetch<{ connections?: AgentConnection[] }>("/agent-connections");
  return data.connections ?? [];
}

export interface NewAgent {
  name: string;
  task: string;
  connection_id: string;
  schedule_label: string;
  interval_seconds: number;
  run_time: string;
  daily_token_limit: number;
  write_access: boolean;
  mission?: boolean;
  send_mail?: boolean;
}

// Oppretter en agent fra config-widgeten; returnerer den lagrede agenten.
export async function createAgent(
  payload: NewAgent
): Promise<{ id: string; chat_id: string }> {
  return apiFetch("/agents", { method: "POST", body: payload });
}

// Oppretter en tom, deaktivert agent-chat brukeren lander i via /agent.
export async function createDraftAgent(): Promise<{
  id: string;
  chat_id: string;
  name: string;
}> {
  return apiFetch("/agents/draft", { method: "POST" });
}

// Live-tilstanden trollet viser i farmen.
export type AgentState =
  | "working"
  | "thinking"
  | "broken"
  | "paused"
  | "sleeping";

export interface AgentInfo {
  id: string;
  name: string;
  enabled: boolean;
  personality?: string;
  category?: string;
  state?: AgentState;
  chat_id?: string;
  plan_status?: string;
  last_run_at?: string;
  next_run_at?: string;
  created_at?: string;
  has_response?: boolean;
  task?: string;
  connection_id?: string;
  schedule_label?: string;
  interval_seconds?: number;
  run_time?: string;
  daily_token_limit?: number;
  write_access?: boolean;
  push_enabled?: boolean;
  mission?: boolean;
  mission_status?: string;
  criteria_approved?: boolean;
  mission_criteria?: string;
  mission_budget?: number;
  mission_activity?: string;
}

// Lagrer mål, fullført-kriterier og token-tak for et oppdrag.
export async function setMissionPlan(
  id: string,
  plan: { goal: string; criteria: string; budget: number }
): Promise<void> {
  await apiFetch(`/agents/${id}/mission`, { method: "POST", body: plan });
}

// Godkjenner kriteriene og starter den kontinuerlige oppdrags-løkka.
export async function approveMission(id: string): Promise<void> {
  await apiFetch(`/agents/${id}/mission/approve`, { method: "POST" });
}

// Oppdaterer en agents konfigurasjon (redigering i agent-chatten).
export async function updateAgent(
  id: string,
  payload: NewAgent
): Promise<void> {
  await apiFetch(`/agents/${id}`, { method: "PUT", body: payload });
}

// Henter agenten som eier en chat (for pause-knappen). null hvis ikke agent-chat.
export async function fetchChatAgent(chatId: string): Promise<AgentInfo | null> {
  try {
    return await apiFetch<AgentInfo>(`/chats/${chatId}/agent`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// Pauser eller gjenopptar en agent.
export async function setAgentEnabled(
  id: string,
  enabled: boolean
): Promise<void> {
  await apiFetch(`/agents/${id}`, { method: "PATCH", body: { enabled } });
}

// Slår push-varsel på/av for en agent.
export async function setAgentPush(id: string, on: boolean): Promise<void> {
  await apiFetch(`/agents/${id}`, { method: "PATCH", body: { push_enabled: on } });
}

// Deaktiverer (sletter) en agent.
export async function deleteAgent(id: string): Promise<void> {
  await apiFetch(`/agents/${id}`, { method: "DELETE" });
}

// Henter alle agentene med live-tilstand (til farmen).
export async function fetchAgents(): Promise<AgentInfo[]> {
  const data = await apiFetch<{ agents?: AgentInfo[] }>("/agents");
  return data.agents ?? [];
}

// Én kjøring i historikken (til trådgrafen).
export interface AgentRunEvent {
  agent_id: string;
  started_at: string;
  status: string;
  has_output: boolean;
  alert?: boolean;
  output?: string;
}

// Henter kjøringshistorikken for brukerens agenter.
export async function fetchAgentRuns(hours = 24): Promise<AgentRunEvent[]> {
  const data = await apiFetch<{ runs?: AgentRunEvent[] }>(`/agents/runs?hours=${hours}`);
  return data.runs ?? [];
}

// Kvitterer ut et ulest agent-svar (pillen i grafen er lest).
export async function markAgentSeen(id: string): Promise<void> {
  await apiFetch(`/agents/${id}/seen`, { method: "POST" });
}

// Setter navn og/eller personlighet på en agent fra farmen.
export async function setAgentPersona(
  id: string,
  persona: { name?: string; personality?: string; category?: string }
): Promise<void> {
  await apiFetch(`/agents/${id}/persona`, { method: "PATCH", body: persona });
}

// Ett steg i agentens kompilerte plan.
export interface PlanStep {
  kind: string;
  label: string;
  connection_id?: string;
  sql?: string;
  query?: string;
  url?: string;
}

export interface PlanChart {
  type: string;
  title: string;
  connection_id?: string;
  sql: string;
  x: string;
  y: string;
  group?: string;
}

export interface PlanMail {
  to_name?: string;
  to_email: string;
  subject: string;
}

// Agentens plan slik flyt-visningen redigerer den.
export interface AgentPlan {
  approach?: string;
  steps: PlanStep[];
  watch: string;
  alert_rule: string;
  chart?: PlanChart | null;
  chart_slug?: string;
  mail?: PlanMail | null;
}

export interface AgentPlanResponse {
  plan: AgentPlan;
  status: string;
  error?: string;
  schedule_label?: string;
  task?: string;
  agent_name?: string;
  interval_seconds?: number;
  run_time?: string;
}

// Setter agentens frekvens fra Start-noden i flyt-visningen.
export async function setAgentSchedule(
  id: string,
  schedule: { interval_seconds: number; run_time?: string; schedule_label?: string }
): Promise<void> {
  await apiFetch(`/agents/${id}/schedule`, { method: "PUT", body: schedule });
}

// Henter agentens plan (til flyt-visningen).
export async function fetchAgentPlan(id: string): Promise<AgentPlanResponse> {
  return apiFetch(`/agents/${id}/plan`);
}

// Lagrer en redigert plan. Kaster med problemene hvis valideringen avviser.
export async function saveAgentPlan(id: string, plan: AgentPlan): Promise<AgentPlan> {
  const res = await apiFetch<{ plan: AgentPlan }>(`/agents/${id}/plan`, {
    method: "PUT",
    body: plan,
  });
  return res.plan;
}

// Kaster planen og ber agenten bygge den på nytt.
export async function rebuildAgentPlan(id: string): Promise<void> {
  await apiFetch(`/agents/${id}/plan/rebuild`, { method: "POST" });
}
