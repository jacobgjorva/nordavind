import { apiFetch, ApiError } from "./client";

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

export interface GraphNode {
  id: string;
  type: string;
  title: string;
  summary: string;
  created_at: string;
  hits: number;
  last_hit_at?: string;
}

export interface GraphEdge {
  from_id: string;
  to_id: string;
  relation: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Kobler to noder i graf-editoren.
export async function createEdge(e: GraphEdge): Promise<void> {
  await apiFetch(`/knowledge/edges`, { method: "POST", body: e });
}

// Fjerner en kant i graf-editoren.
export async function removeEdge(e: GraphEdge): Promise<void> {
  await apiFetch(`/knowledge/edges/delete`, { method: "POST", body: e });
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

// Dublettvakten: den lignende lappen backend fant ved godkjenning.
export interface DuplicateInfo {
  id: string;
  title: string;
  text: string;
  similarity: number;
}

// Godkjenner en node (med evt. redigert tekst). Ligner forslaget for mye på
// en eksisterende lapp, stopper backend med 409 og vi returnerer kandidaten
// så panelet kan la admin velge erstatt/behold.
export async function acceptNode(
  id: string,
  title: string,
  summary: string,
  opts: { replaceId?: string; keepBoth?: boolean } = {}
): Promise<{ duplicate?: DuplicateInfo }> {
  try {
    await apiFetch(`/knowledge/${id}/accept`, {
      method: "POST",
      body: {
        title,
        summary,
        replace_id: opts.replaceId ?? "",
        keep_both: opts.keepBoth ?? false,
      },
    });
    return {};
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      try {
        return { duplicate: JSON.parse(e.message).duplicate as DuplicateInfo };
      } catch {
        /* faller til vanlig feil */
      }
    }
    throw e;
  }
}

// Sletter en akseptert node fra grafen.
export async function deleteNode(id: string): Promise<void> {
  await apiFetch(`/knowledge/${id}`, { method: "DELETE" });
}

// Avviser en node.
export async function rejectNode(id: string): Promise<void> {
  await apiFetch(`/knowledge/${id}/reject`, { method: "POST" });
}

// Entiteter hjernen kjenner — grunnlaget for @-nevninger i meldingsfeltet.
export interface BrainEntity {
  id: string;
  name: string;
  kind: string;
}

export async function searchEntities(q: string): Promise<BrainEntity[]> {
  const d = await apiFetch<{ entities?: BrainEntity[] }>(
    `/entities?q=${encodeURIComponent(q)}`
  );
  return d.entities ?? [];
}
