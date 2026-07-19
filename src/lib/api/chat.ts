import { BASE_URL, API_KEY, authHeaders, apiFetch } from "./client";
import type { ApiMessage, Role } from "./client";

export interface ChatSummary {
  id: string;
  title: string;
  updated_at: string;
  agent_id?: string;
  agent_enabled?: boolean;
  kind?: string;
}

export interface StoredMessage {
  role: Role;
  content: string;
  sources?: string;
}

export async function fetchChats(): Promise<ChatSummary[]> {
  const data = await apiFetch<{ chats?: ChatSummary[] }>("/chats");
  return data.chats ?? [];
}

export async function createChat(title: string): Promise<ChatSummary> {
  return apiFetch("/chats", { method: "POST", body: { title } });
}

export async function fetchChatMessages(id: string): Promise<StoredMessage[]> {
  const data = await apiFetch<{ messages?: StoredMessage[] }>(`/chats/${id}`);
  return data.messages ?? [];
}

export async function appendChatMessage(
  id: string,
  msg: StoredMessage
): Promise<void> {
  await apiFetch(`/chats/${id}/messages`, { method: "POST", body: msg });
}

// Starter passivt kunnskaps-uttrekk fra en utveksling (fyr og glem).
export function extractKnowledge(payload: {
  chat_id?: string;
  question: string;
  answer: string;
}): void {
  fetch(`${BASE_URL}/knowledge/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

// Logger neste brukermelding som korrigering på et AI-svar (opptrening senere).
export async function logCorrection(payload: {
  answer: string;
  correction: string;
  chat_id?: string;
}): Promise<void> {
  await apiFetch("/corrections", { method: "POST", body: payload });
}

export async function generateChatTitle(
  id: string,
  question: string,
  answer: string
): Promise<string> {
  const data = await apiFetch<{ title: string }>(`/chats/${id}/title`, {
    method: "POST",
    body: { question, answer },
  });
  return data.title;
}

// Setter en manuell tittel på samtalen.
export async function renameChat(id: string, title: string): Promise<string> {
  const data = await apiFetch<{ title: string }>(`/chats/${id}`, {
    method: "PATCH",
    body: { title },
  });
  return data.title;
}

export interface Attachment {
  name: string;
  /** Uttrukket tekst (PDF/tekstfil). Tom for bilder. */
  text: string;
  /** data:-URL for bilder som sendes til vision-modellen. */
  image?: string;
}

// Leser et bilde som base64 data-URL – sendes direkte til vision-modellen,
// ingen server-prosessering eller betalt OCR.
export function readImage(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({ name: file.name, text: "", image: String(reader.result) });
    reader.onerror = () => reject(new Error("kunne ikke lese bildet"));
    reader.readAsDataURL(file);
  });
}

// Laster opp en fil og får ren tekst tilbake (PDF/tekst).
export async function extractFile(file: File): Promise<Attachment> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${BASE_URL}/extract`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    throw new Error((await res.text().catch(() => "")) || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface SourceRef {
  title: string;
  url: string;
}

export interface StreamDelta {
  content?: string;
  reasoning?: string;
  /** Faktisk modell valgt av backend (relevant ved model: "auto") */
  model?: string;
  /** Kilder fra backendens websøk */
  sources?: SourceRef[];
  /** Fremdriftssteg til thinking-tidslinjen */
  step?: string;
  /** Widget-specen ble endret av et verktøykall */
  widgetUpdated?: boolean;
}

// Ett enkelt ikke-streamet chatkall (brukes av connector-agenten).
export async function completeChat(
  model: string,
  messages: ApiMessage[]
): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      max_tokens: 200,
      temperature: 0.2,
      reasoning: { enabled: false },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return body.choices?.[0]?.message?.content ?? "";
}

export async function streamChat(
  model: string,
  messages: ApiMessage[],
  onDelta: (delta: StreamDelta) => void,
  signal?: AbortSignal,
  opts?: { agentSetup?: boolean; agentEdit?: string; widget?: string }
): Promise<void> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      ...authHeaders(),
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      // Reasoning gir merkbart tregere første token; av som default i test-UI.
      reasoning: { enabled: false },
      // /agent-flyten: gir modellen verktøy til å administrere agenter.
      ...(opts?.agentSetup ? { nordavind_agent_setup: true } : {}),
      // Agent-chat: la modellen endre agenten når brukeren ber om det.
      ...(opts?.agentEdit ? { nordavind_agent_edit: opts.agentEdit } : {}),
      // Widget-editor: modellen bygger én widget via verktøy.
      ...(opts?.widget ? { nordavind_widget: opts.widget } : {}),
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data);
        const sources = json.nordavind_sources as SourceRef[] | undefined;
        const step = json.nordavind_step as string | undefined;
        const widgetUpdated = json.nordavind_widget_updated as
          | boolean
          | undefined;
        const delta = json.choices?.[0]?.delta;
        const content = delta?.content;
        const reasoning = delta?.reasoning ?? delta?.reasoning_content;
        // Modellnavn kan ha leverandørprefiks ("lyceum/glm-5.2")
        const model = (json.model as string | undefined)?.split("/").pop();
        if (content || reasoning || model || sources || step || widgetUpdated) {
          onDelta({ content, reasoning, model, sources, step, widgetUpdated });
        }
      } catch {
        // ufullstendig chunk — ignorer
      }
    }
  }
}

// --- Databasetilkoblinger (kundens interne data) ---
