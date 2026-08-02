import { BASE_URL, API_KEY, authHeaders, apiFetch } from "./client";
import type { ApiMessage, Role } from "./client";

export interface ChatSummary {
  id: string;
  title: string;
  updated_at: string;
  agent_id?: string;
  agent_enabled?: boolean;
  kind?: string;
  /** Design-chat: dokumentet den eier. */
  design_slug?: string;
  folder_id?: string;
}

export interface Folder {
  id: string;
  name: string;
  created_at: string;
}

export async function fetchFolders(): Promise<Folder[]> {
  const data = await apiFetch<{ folders?: Folder[] }>("/folders");
  return data.folders ?? [];
}

export async function createFolder(name: string): Promise<Folder> {
  return apiFetch("/folders", { method: "POST", body: { name } });
}

export async function renameFolder(id: string, name: string): Promise<void> {
  await apiFetch(`/folders/${id}`, { method: "PATCH", body: { name } });
}

export async function deleteFolder(id: string): Promise<void> {
  await apiFetch(`/folders/${id}`, { method: "DELETE" });
}

// Flytter en chat inn i en mappe (tom folderId = ut av mappe).
export async function setChatFolder(
  chatId: string,
  folderId: string
): Promise<void> {
  await apiFetch(`/chats/${chatId}/folder`, {
    method: "PUT",
    body: { folder_id: folderId },
  });
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
// Kunnskapsforslag fra en utveksling — lagres først når kilden bekrefter.
export interface KnowledgeProposal {
  type: string;
  title: string;
  summary: string;
}


// Eksplisitt minne: brukeren klikket minnekortet på en melding.
export async function rememberMessage(payload: {
  text: string;
  chat_id?: string;
  scope?: string; // "" arv | "tenant" | "private"
}): Promise<void> {
  await apiFetch(`/knowledge/remember`, { method: "POST", body: payload });
}

// Kilden bekreftet: lagre kunnskapen (accepted, med automatisk dublettvakt).
export async function confirmKnowledge(p: KnowledgeProposal & { chat_id?: string }): Promise<void> {
  await apiFetch(`/knowledge/confirm`, { method: "POST", body: p });
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

// Sletter en samtale (og agenten dersom det er en agent-chat).
export async function deleteChat(id: string): Promise<void> {
  await apiFetch(`/chats/${id}`, { method: "DELETE" });
}

// Eksporterer en tabell som ren .xlsx og starter nedlasting i nettleseren.
export async function exportTableXLSX(
  title: string,
  columns: string[],
  rows: string[][]
): Promise<void> {
  const res = await fetch(`${BASE_URL}/export/xlsx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      ...authHeaders(),
    },
    body: JSON.stringify({ title, columns, rows }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const el = document.createElement("a");
  el.href = url;
  el.download =
    res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ??
    "tabell.xlsx";
  el.click();
  URL.revokeObjectURL(url);
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
  /** Hva steget handler om (db, web, file, mail, table, agent, link) — styrer ikonet */
  stepKind?: string;
  /** Widget-specen ble endret av et verktøykall */
  widgetUpdated?: boolean;
  /** Databasespørringen bak svaret (til live Excel-eksport) */
  query?: TableQuery;
  /** Connector-agenten ber om at Microsoft-innloggingen åpnes */
  m365Auth?: string;
  /** Connector-agenten opprettet en tilkobling (id) */
  connectionCreated?: string;
  /** Dokumentet på lerretet ble endret av et verktøykall (slug) */
  designUpdated?: string;
}

export interface TableQuery {
  connection_id: string;
  sql: string;
}

// Oppretter en live arbeidsbok i brukerens OneDrive (vi pusher ferske tall).
// Returnerer url til boka. 501 = Microsoft-integrasjonen er ikke konfigurert.
export async function exportToOneDrive(
  title: string,
  query: TableQuery
): Promise<{ url?: string }> {
  return apiFetch("/export/onedrive", {
    method: "POST",
    body: { title, connection_id: query.connection_id, sql: query.sql },
  });
}

// Lager en live Excel-eksport: laster ned .xlsx med data + Live-ark, og
// returnerer live-lenken (for kopiering). Tokenet i lenken kan kun kjøre
// akkurat denne spørringen.
export async function exportTableLiveXLSX(
  title: string,
  query: TableQuery
): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/export/live`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      ...authHeaders(),
    },
    body: JSON.stringify({
      title,
      connection_id: query.connection_id,
      sql: query.sql,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const liveURL = res.headers.get("X-Live-Url");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const el = document.createElement("a");
  el.href = url;
  el.download =
    res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ??
    "tabell.xlsx";
  el.click();
  URL.revokeObjectURL(url);
  return liveURL;
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
  opts?: {
    agentSetup?: boolean;
    agentEdit?: string;
    widget?: string;
    connector?: boolean;
    design?: string;
    chatId?: string;
    clipped?: boolean;
  }
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
      // Connector-agent: hjelper brukeren koble til eksterne kilder.
      ...(opts?.connector ? { nordavind_connector: true } : {}),
      // Åpent designlerret: modellen bygger og endrer dette dokumentet.
      ...(opts?.design ? { nordavind_design: opts.design } : {}),
      // Samtale-id + klipp-flagg: når historikken er kuttet mot tegnbudsjettet,
      // injiserer backend det rullerende samtalesammendraget som kontekst.
      ...(opts?.chatId ? { nordavind_chat: opts.chatId } : {}),
      ...(opts?.clipped ? { nordavind_clipped: true } : {}),
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
        const stepKind = json.nordavind_step_kind as string | undefined;
        const query = json.nordavind_query as TableQuery | undefined;
        const m365Auth = json.nordavind_m365_auth as string | undefined;
        const connectionCreated = json.nordavind_connection_created as
          | string
          | undefined;
        const widgetUpdated = json.nordavind_widget_updated as
          | boolean
          | undefined;
        const designUpdated = json.nordavind_design_updated as string | undefined;
        const delta = json.choices?.[0]?.delta;
        const content = delta?.content;
        const reasoning = delta?.reasoning ?? delta?.reasoning_content;
        // Modellnavn kan ha leverandørprefiks ("lyceum/glm-5.2")
        const model = (json.model as string | undefined)?.split("/").pop();
        if (
          content || reasoning || model || sources || step ||
          widgetUpdated || query || m365Auth || connectionCreated || designUpdated
        ) {
          onDelta({
            content, reasoning, model, sources, step, stepKind,
            widgetUpdated, query, m365Auth, connectionCreated, designUpdated,
          });
        }
      } catch {
        // ufullstendig chunk — ignorer
      }
    }
  }
}

// --- Databasetilkoblinger (kundens interne data) ---
