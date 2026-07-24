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

export const BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;

export const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

export const apiConfigured = Boolean(BASE_URL);

const TOKEN_KEY = "nordavind_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);

export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);

export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export function authHeaders(): Record<string, string> {
  const token = getToken();
  const imp = getImpersonation();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(imp ? { "X-Impersonate-User": imp.id } : {}),
  };
}

// --- Admin-simulering: admin trer inn i en annen brukers tilstand. ---
const IMP_KEY = "nordavind.impersonate";

export interface Impersonation {
  id: string;
  email: string;
}

export function getImpersonation(): Impersonation | null {
  try {
    const raw = localStorage.getItem(IMP_KEY);
    return raw ? (JSON.parse(raw) as Impersonation) : null;
  } catch {
    return null;
  }
}

export const setImpersonation = (imp: Impersonation | null) => {
  if (imp) localStorage.setItem(IMP_KEY, JSON.stringify(imp));
  else localStorage.removeItem(IMP_KEY);
};



// ApiError bærer HTTP-statusen så kallere kan skille f.eks. 404 fra 500.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface FetchOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

// apiFetch er den ene inngangen mot backend: setter base-URL, auth-header og
// JSON-body, og kaster ApiError med statuskoden ved feil. Returnerer T for
// JSON-svar, og undefined for 204/tomme svar.
export async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = opts;
  const headers: Record<string, string> = { ...authHeaders() };
  // /auth og /me skal alltid svare som den EKTE brukeren — appen må vite
  // hvem admin er selv midt i en simulering.
  if (path.startsWith("/auth") || path === "/me") delete headers["X-Impersonate-User"];
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return undefined as T;
  return res.json() as Promise<T>;
}
