import { BASE_URL, authHeaders } from "./client";

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

type ThreadResult = { messages: MailMessage[]; signature: string; me: string };

// Cachet: hover-preview, trådkortet og svarforslaget deler samme henting.
const threadCache = new Map<string, Promise<ThreadResult>>();

export function fetchThread(key: string): Promise<ThreadResult> {
  const cached = threadCache.get(key);
  if (cached) return cached;
  const p = (async () => {
    const res = await fetch(`${BASE_URL}/mail/thread?key=${encodeURIComponent(key)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<ThreadResult>;
  })();
  threadCache.set(key, p);
  p.catch(() => threadCache.delete(key));
  return p;
}

// Rått forhåndsvisnings-utdrag (ingen AI): siste melding, første linjer.
export async function threadPreview(
  key: string
): Promise<{ subject: string; snippet: string }> {
  const r = await fetchThread(key);
  const last = r.messages[r.messages.length - 1];
  const subject = (r.messages[0]?.subject ?? "").replace(/^\s*(re|sv|svar)\s*:\s*/i, "");
  const snippet = (last?.body ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 5)
    .join("\n")
    .slice(0, 320);
  return { subject, snippet };
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
