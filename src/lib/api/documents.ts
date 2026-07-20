import { apiFetch } from "./client";

export interface SavedDocument {
  id: string;
  title: string;
  summary: string;
  chunks: number;
}

// saveDocument lagrer et opplastet dokument som bedriftskunnskap. Teksten er
// allerede uttrukket i frontend (extractFile), så den går rett til backend —
// aldri gjennom modellen.
export async function saveDocument(payload: {
  filename: string;
  text: string;
  title?: string;
  chat_id?: string;
}): Promise<SavedDocument> {
  return apiFetch("/documents", { method: "POST", body: payload });
}

export interface LibraryDocument {
  id: string;
  title: string;
  filename: string;
  notes: number;
  created_at: string;
}

export async function listDocuments(): Promise<LibraryDocument[]> {
  const data = await apiFetch<{ documents?: LibraryDocument[] }>("/documents");
  return data.documents ?? [];
}

export async function deleteDocument(id: string): Promise<void> {
  await apiFetch(`/documents/${id}`, { method: "DELETE" });
}
