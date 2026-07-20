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
