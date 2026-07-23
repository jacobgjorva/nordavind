import { apiFetch } from "./client";

// Kun send-evnen beholdes. Lesing/analyse av innboks er fjernet (ute av scope).
export interface MailPerson {
  name: string;
  address: string;
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
