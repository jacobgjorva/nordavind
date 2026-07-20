import { apiFetch } from "./client";

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
  const data = await apiFetch<{ nodes?: KnowledgeNode[] }>("/knowledge/pending");
  return data.nodes ?? [];
}

export interface GraphData {
  nodes: { id: string; type: string; title: string; summary: string }[];
  edges: { from_id: string; to_id: string; relation: string }[];
}

// Henter kunnskapsgrafen (aksepterte noder + kanter) til visualisering.
export async function fetchKnowledgeGraph(): Promise<GraphData> {
  return apiFetch("/knowledge/graph");
}

// Redigerer en akseptert node manuelt.
export async function updateNode(
  id: string,
  title: string,
  summary: string
): Promise<void> {
  await apiFetch(`/knowledge/${id}`, { method: "PUT", body: { title, summary } });
}

// Godkjenner en node (med evt. redigert tekst).
export async function acceptNode(
  id: string,
  title: string,
  summary: string
): Promise<void> {
  await apiFetch(`/knowledge/${id}/accept`, {
    method: "POST",
    body: { title, summary },
  });
}

// Sletter en akseptert node fra grafen.
export async function deleteNode(id: string): Promise<void> {
  await apiFetch(`/knowledge/${id}`, { method: "DELETE" });
}

// Avviser en node.
export async function rejectNode(id: string): Promise<void> {
  await apiFetch(`/knowledge/${id}/reject`, { method: "POST" });
}
