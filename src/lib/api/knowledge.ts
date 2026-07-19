import { BASE_URL, authHeaders } from "./client";

export interface KnowledgeNode {
  id: string;
  type: string;
  title: string;
  summary: string;
  created_at: string;
  user_email?: string;
}

// Henter noder som venter på admin-godkjenning.
export async function fetchPendingNodes(): Promise<KnowledgeNode[]> {
  const res = await fetch(`${BASE_URL}/knowledge/pending`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).nodes ?? [];
}

export interface GraphData {
  nodes: { id: string; type: string; title: string; summary: string }[];
  edges: { from_id: string; to_id: string; relation: string }[];
}

// Henter kunnskapsgrafen (aksepterte noder + kanter) til visualisering.
export async function fetchKnowledgeGraph(): Promise<GraphData> {
  const res = await fetch(`${BASE_URL}/knowledge/graph`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Redigerer en akseptert node manuelt.
export async function updateNode(
  id: string,
  title: string,
  summary: string
): Promise<void> {
  const res = await fetch(`${BASE_URL}/knowledge/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title, summary }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// Godkjenner en node (med evt. redigert tekst).
export async function acceptNode(
  id: string,
  title: string,
  summary: string
): Promise<void> {
  const res = await fetch(`${BASE_URL}/knowledge/${id}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title, summary }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// Avviser en node.
export async function rejectNode(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/knowledge/${id}/reject`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
