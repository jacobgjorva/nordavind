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
}

// Oppretter en agent fra config-widgeten; returnerer den lagrede agenten.
export async function createAgent(
  payload: NewAgent
): Promise<{ id: string; chat_id: string }> {
  return apiFetch("/agents", { method: "POST", body: payload });
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

// Deaktiverer (sletter) en agent.
export async function deleteAgent(id: string): Promise<void> {
  await apiFetch(`/agents/${id}`, { method: "DELETE" });
}
