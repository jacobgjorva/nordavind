export type Role = "user" | "assistant" | "system";

// Multimodalt innhold: enten ren tekst, eller en array av deler
// (tekst + bilde) i OpenAI-format for vision-modeller.
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ApiMessage {
  role: Role;
  content: string | ContentPart[];
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
  agent_id?: string;
  agent_enabled?: boolean;
  kind?: string;
}

// WidgetSpec er én visualisering (kpi/text/table/bar/line).
export interface WidgetSpec {
  type?: string;
  title?: string;
  value?: string;
  unit?: string;
  delta?: string;
  content?: string;
  connection_id?: string;
  sql?: string;
  x?: string;
  y?: string;
}

// Widget slik den ligger i registeret; spec finnes kun ved henting av én.
export interface Widget {
  id: string;
  slug: string;
  title: string;
  spec?: WidgetSpec;
  updated_at: string;
}

export interface QueryResult {
  columns: string[];
  rows: (string | number | null)[][];
}

// Lister brukerens widgets (til slash-menyen).
export async function listWidgets(): Promise<Widget[]> {
  const res = await fetch(`${BASE_URL}/widgets`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Oppretter en tom widget med gitt navn.
export async function createWidget(title: string): Promise<Widget> {
  const res = await fetch(`${BASE_URL}/widgets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Henter én widget med spec.
export async function fetchWidget(slug: string): Promise<Widget> {
  const res = await fetch(`${BASE_URL}/widgets/${slug}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Kjører widgetens datakilde (read-only).
export async function fetchWidgetData(slug: string): Promise<QueryResult> {
  const res = await fetch(`${BASE_URL}/widgets/${slug}/query`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Sletter en widget.
export async function deleteWidget(slug: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/widgets/${slug}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

// Sletter en node.
export async function deleteKnowledgeNode(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/knowledge/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
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
  const res = await fetch(`${BASE_URL}/corrections`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
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

// Setter en manuell tittel på samtalen.
export async function renameChat(id: string, title: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/chats/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title }),
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

// ── Mail ──
export interface MailAccount {
  email: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  signature: string;
}

export interface MailPerson {
  name: string;
  address: string;
}

export interface MailThreadSummary {
  key: string;
  subject: string;
  from: MailPerson;
  snippet: string;
  date: string;
  count: number;
  unread: number;
  attach: boolean;
}

export interface MailAttachment {
  filename: string;
  type: string;
  size: number;
}

export interface MailMessage {
  uid: number;
  message_id: string;
  from: MailPerson;
  to: MailPerson[];
  cc: MailPerson[];
  date: string;
  subject: string;
  body: string;
  attachments: MailAttachment[];
  unread: boolean;
}

export interface MailAnalysis {
  summary: string;
  essences: string[];
  proposal: string;
  draft: string;
}

export async function fetchMailAccount(): Promise<MailAccount | null> {
  const res = await fetch(`${BASE_URL}/mail/account`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function saveMailAccount(a: MailAccount & { password: string }): Promise<void> {
  const res = await fetch(`${BASE_URL}/mail/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(a),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
}

export async function deleteMailAccount(): Promise<void> {
  await fetch(`${BASE_URL}/mail/account`, { method: "DELETE", headers: authHeaders() });
}

export async function fetchInbox(): Promise<MailThreadSummary[]> {
  const res = await fetch(`${BASE_URL}/mail/inbox`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).threads ?? [];
}

export async function fetchThread(
  key: string
): Promise<{ messages: MailMessage[]; signature: string; me: string }> {
  const res = await fetch(`${BASE_URL}/mail/thread?key=${encodeURIComponent(key)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Deles av trådkortet og forslags-meldingen så tråden bare tolkes én gang.
const analyzeCache = new Map<string, Promise<MailAnalysis>>();

export function analyzeThread(key: string): Promise<MailAnalysis> {
  const cached = analyzeCache.get(key);
  if (cached) return cached;
  const p = (async () => {
    const res = await fetch(`${BASE_URL}/mail/analyze?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<MailAnalysis>;
  })();
  analyzeCache.set(key, p);
  p.catch(() => analyzeCache.delete(key)); // la feil kunne prøves på nytt
  return p;
}

export async function refineDraft(
  key: string,
  current: string,
  feedback: string
): Promise<string> {
  const res = await fetch(`${BASE_URL}/mail/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ key, current, feedback }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).draft;
}

export interface SendMailPayload {
  to: MailPerson[];
  cc: MailPerson[];
  bcc: MailPerson[];
  subject: string;
  body: string;
  in_reply_to?: string;
  references?: string;
}

export async function sendMail(p: SendMailPayload): Promise<void> {
  const res = await fetch(`${BASE_URL}/mail/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(p),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
}
