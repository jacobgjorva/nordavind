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
