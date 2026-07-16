export type Role = "user" | "assistant" | "system";

export interface ApiMessage {
  role: Role;
  content: string;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

export const MODELS = (
  (import.meta.env.VITE_MODELS as string | undefined) ??
  "auto,glm-5.2,kimi-k2.6"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

export const apiConfigured = Boolean(BASE_URL);

export interface StreamDelta {
  content?: string;
  reasoning?: string;
  /** Faktisk modell valgt av backend (relevant ved model: "auto") */
  model?: string;
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
        const delta = json.choices?.[0]?.delta;
        const content = delta?.content;
        const reasoning = delta?.reasoning ?? delta?.reasoning_content;
        // Modellnavn kan ha leverandørprefiks ("lyceum/glm-5.2")
        const model = (json.model as string | undefined)?.split("/").pop();
        if (content || reasoning || model) onDelta({ content, reasoning, model });
      } catch {
        // ufullstendig chunk — ignorer
      }
    }
  }
}
