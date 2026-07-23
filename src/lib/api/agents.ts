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

export interface AgentInfo {
  id: string;
  name: string;
  enabled: boolean;
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
