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
