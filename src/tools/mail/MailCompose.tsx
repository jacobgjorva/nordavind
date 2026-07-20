import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { TelegramIcon } from "@hugeicons/core-free-icons";
import { sendMail, type MailPerson } from "../../lib/api";
import styles from "./MailCompose.module.css";

// Parser en fritekst-mottakerliste ("Navn <a@b.no>, c@d.no") til MailPerson[].
function parseRecipients(text: string): MailPerson[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.*)<([^>]+)>$/);
      if (m) return { name: m[1].trim(), address: m[2].trim() };
      return { name: "", address: s };
    });
}

function formatRecipients(ps: MailPerson[]): string {
  return ps
    .map((p) => (p.name ? `${p.name} <${p.address}>` : p.address))
    .join(", ");
}

export interface ComposeSpec {
  to?: MailPerson[];
  subject?: string;
  body?: string;
}

// Redigerbart send-kort: mottaker forhåndsutfylt av AI-en, brukeren justerer og
// sender. Bruker send-evnen som ble beholdt (sendMail).
export function MailCompose({ spec }: { spec: ComposeSpec }) {
  const [to, setTo] = useState(formatRecipients(spec.to ?? []));
  const [subject, setSubject] = useState(spec.subject ?? "");
  const [body, setBody] = useState(spec.body ?? "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recipients = parseRecipients(to);

  async function send() {
    if (sending || sent || recipients.length === 0) return;
    setSending(true);
    setError(null);
    try {
      await sendMail({ to: recipients, cc: [], bcc: [], subject, body });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sending feilet");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className={styles.card}>
        <div className={styles.sent}>Sendt til {recipients.map((r) => r.address).join(", ")} ✓</div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.field}>
        <span className={styles.label}>Til</span>
        <input
          className={styles.input}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="mottaker@bedrift.no"
        />
      </div>
      <div className={styles.field}>
        <span className={styles.label}>Emne</span>
        <input
          className={styles.input}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Emne"
        />
      </div>
      <textarea
        className={styles.body}
        value={body}
        rows={6}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Skriv meldingen …"
      />
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.footer}>
        <button
          className={styles.send}
          onClick={send}
          disabled={sending || recipients.length === 0}
        >
          <HugeiconsIcon icon={TelegramIcon} size={15} />
          {sending ? "Sender …" : "Send"}
        </button>
      </div>
    </div>
  );
}
