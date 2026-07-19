import { BASE_URL, authHeaders } from "./client";

export interface AgentConnection {
  id: string;
  name: string;
  driver: string;
}

// Tilkoblingene agent-widgeten lar brukeren velge mellom.
export async function fetchAgentConnections(): Promise<AgentConnection[]> {
  const res = await fetch(`${BASE_URL}/agent-connections`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).connections ?? [];
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
  const res = await fetch(`${BASE_URL}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return res.json();
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
  const res = await fetch(`${BASE_URL}/agents/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
}

// Henter agenten som eier en chat (for pause-knappen). null hvis ikke agent-chat.
export async function fetchChatAgent(chatId: string): Promise<AgentInfo | null> {
  const res = await fetch(`${BASE_URL}/chats/${chatId}/agent`, {
    headers: authHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Pauser eller gjenopptar en agent.
export async function setAgentEnabled(
  id: string,
  enabled: boolean
): Promise<void> {
  const res = await fetch(`${BASE_URL}/agents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// Deaktiverer (sletter) en agent.
export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/agents/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
