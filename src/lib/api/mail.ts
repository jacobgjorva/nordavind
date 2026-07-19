import { apiFetch } from "./client";

// ── Mail ──
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

export async function fetchInbox(): Promise<MailThreadSummary[]> {
  const data = await apiFetch<{ threads?: MailThreadSummary[] }>("/mail/inbox");
  return data.threads ?? [];
}

type ThreadResult = { messages: MailMessage[]; signature: string; me: string };

// Cachet: hover-preview, trådkortet og svarforslaget deler samme henting.
const threadCache = new Map<string, Promise<ThreadResult>>();

export function fetchThread(key: string): Promise<ThreadResult> {
  const cached = threadCache.get(key);
  if (cached) return cached;
  const p = apiFetch<ThreadResult>(`/mail/thread?key=${encodeURIComponent(key)}`);
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
  const p = apiFetch<MailAnalysis>(
    `/mail/analyze?key=${encodeURIComponent(key)}`,
    { method: "POST" }
  );
  analyzeCache.set(key, p);
  p.catch(() => analyzeCache.delete(key)); // la feil kunne prøves på nytt
  return p;
}

export async function refineDraft(
  key: string,
  current: string,
  feedback: string
): Promise<string> {
  const data = await apiFetch<{ draft: string }>("/mail/draft", {
    method: "POST",
    body: { key, current, feedback },
  });
  return data.draft;
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
  await apiFetch("/mail/send", { method: "POST", body: p });
}
