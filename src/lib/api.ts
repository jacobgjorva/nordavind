export type Role = "user" | "assistant" | "system";

export interface ApiMessage {
  role: Role;
  content: string;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

export const MODELS = (
  (import.meta.env.VITE_MODELS as string | undefined) ??
  "glm-5.2,kimi-k2.7"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

export const apiConfigured = Boolean(BASE_URL);

export async function streamChat(
  model: string,
  messages: ApiMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify({ model, messages, stream: true }),
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
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) onDelta(delta);
      } catch {
        // ufullstendig chunk — ignorer
      }
    }
  }
}
