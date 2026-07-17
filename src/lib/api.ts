export type Role = "user" | "assistant" | "system";

export interface ApiMessage {
  role: Role;
  content: string;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

export const apiConfigured = Boolean(BASE_URL);

const TOKEN_KEY = "nordavind_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface AuthUser {
  id: string;
  tenant_id: string;
  email: string;
  role: string;
}

export interface AuthTenant {
  id: string;
  name: string;
}

export async function requestCode(email: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/auth/request-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function verifyCode(
  email: string,
  code: string
): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${BASE_URL}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  if (res.status === 401) throw new Error("Ugyldig kode");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface DailyUsage {
  day: string;
  model: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  searches: number;
}

export async function fetchDailyUsage(
  days: number,
  scope: "me" | "tenant"
): Promise<{ usage: DailyUsage[]; usdNok: number }> {
  const res = await fetch(
    `${BASE_URL}/usage/daily?days=${days}&scope=${scope}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return { usage: body.usage ?? [], usdNok: body.usd_nok ?? 0 };
}

export interface ChatSummary {
  id: string;
  title: string;
  updated_at: string;
}

export interface StoredMessage {
  role: Role;
  content: string;
  sources?: string;
}

export async function fetchChats(): Promise<ChatSummary[]> {
  const res = await fetch(`${BASE_URL}/chats`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).chats ?? [];
}

export async function createChat(title: string): Promise<ChatSummary> {
  const res = await fetch(`${BASE_URL}/chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchChatMessages(id: string): Promise<StoredMessage[]> {
  const res = await fetch(`${BASE_URL}/chats/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).messages ?? [];
}

export async function appendChatMessage(
  id: string,
  msg: StoredMessage
): Promise<void> {
  const res = await fetch(`${BASE_URL}/chats/${id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(msg),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function generateChatTitle(
  id: string,
  question: string,
  answer: string
): Promise<string> {
  const res = await fetch(`${BASE_URL}/chats/${id}/title`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ question, answer }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).title;
}

export async function deleteChat(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/chats/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export interface AdminUser extends AuthUser {
  usage: {
    requests: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
  };
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const res = await fetch(`${BASE_URL}/admin/users`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).users ?? [];
}

export async function createAdminUser(
  email: string,
  role: string
): Promise<void> {
  const res = await fetch(`${BASE_URL}/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
}

export async function deleteAdminUser(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/admin/users/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function fetchMe(): Promise<{
  user: AuthUser;
  tenant: AuthTenant;
}> {
  const res = await fetch(`${BASE_URL}/auth/me`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface Attachment {
  name: string;
  text: string;
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
  signal?: AbortSignal
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
        const delta = json.choices?.[0]?.delta;
        const content = delta?.content;
        const reasoning = delta?.reasoning ?? delta?.reasoning_content;
        // Modellnavn kan ha leverandørprefiks ("lyceum/glm-5.2")
        const model = (json.model as string | undefined)?.split("/").pop();
        if (content || reasoning || model || sources || step) {
          onDelta({ content, reasoning, model, sources, step });
        }
      } catch {
        // ufullstendig chunk — ignorer
      }
    }
  }
}

// --- Databasetilkoblinger (kundens interne data) ---

export interface Connection {
  id: string;
  name: string;
  driver: string;
}

export interface DbColumn {
  name: string;
  type: string;
}

export interface DbTable {
  name: string;
  columns: DbColumn[];
}

export interface DbLink {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
}

export interface TableConfig {
  name: string;
  description: string;
  columns: Record<string, string>;
  user_ids: string[];
}

export interface DbView {
  name: string;
  sql: string;
  description: string;
}

export interface ConnectionSchema {
  connection: Connection;
  tables: DbTable[];
  suggested_links: DbLink[] | null;
  config: {
    tables: TableConfig[] | null;
    links: DbLink[] | null;
    views: DbView[] | null;
  };
}

export async function fetchConnections(): Promise<Connection[]> {
  const res = await fetch(`${BASE_URL}/connections`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).connections ?? [];
}

export async function createConnection(payload: {
  name: string;
  driver: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): Promise<Connection> {
  const res = await fetch(`${BASE_URL}/connections`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return res.json();
}

export async function testConnection(payload: {
  driver: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): Promise<void> {
  const res = await fetch(`${BASE_URL}/connections/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
}

export async function deleteConnection(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/connections/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function fetchConnectionSchema(id: string): Promise<ConnectionSchema> {
  const res = await fetch(`${BASE_URL}/connections/${id}/schema`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return res.json();
}

export async function saveConnectionConfig(
  id: string,
  tables: TableConfig[],
  links: DbLink[],
  views: DbView[]
): Promise<void> {
  const res = await fetch(`${BASE_URL}/connections/${id}/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ tables, links, views }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
