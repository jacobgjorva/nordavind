import { apiFetch } from "./client";

export interface M365Status {
  configured: boolean;
  connected: boolean;
  email?: string;
  created_at?: string;
}

// Status for Microsoft 365-connectoren (konfigurert? koblet til?).
export async function fetchM365Status(): Promise<M365Status> {
  return apiFetch("/m365/status");
}

// Starter OAuth-flyten; åpne url-en i nytt vindu.
export async function connectM365(): Promise<{ url: string }> {
  return apiFetch("/m365/connect");
}

// Kobler brukeren fra Microsoft 365.
export async function disconnectM365(): Promise<void> {
  await apiFetch("/m365", { method: "DELETE" });
}

// Lagrer tenantens Azure app-registrering (admin). Secret sendes kun hit.
export async function saveM365App(payload: {
  client_id: string;
  client_secret: string;
  directory_id: string;
}): Promise<void> {
  await apiFetch("/m365/app", { method: "POST", body: payload });
}
