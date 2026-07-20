import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { TelegramIcon } from "@hugeicons/core-free-icons";
import { sendMail, type MailPerson } from "../../lib/api";
import styles from "./MailCompose.module.css";

// Lys bakgrunn + mørk variant av samme farge til initialene.
const AVATAR_COLORS: [string, string][] = [
  ["#E6F2FF", "#2e6bad"],
  ["#CDFBFB", "#1f8a8a"],
  ["#D8FDE4", "#2f8a54"],
  ["#E8FDCA", "#5f7d1e"],
  ["#FDF2B2", "#94711a"],
  ["#FFE6E8", "#b0505a"],
  ["#EEEAFF", "#6152b3"],
];

function avatarColor(addr: string): [string, string] {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(p: MailPerson): string {
  const src = (p.name || p.address).trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

type Field = "to" | "cc";
const FIELD_LABEL: Record<Field, string> = { to: "Til", cc: "Kopi" };

function ChipRow({
  f,
  people,
  onRemove,
  onAdd,
}: {
  f: Field;
  people: MailPerson[];
  onRemove: (addr: string) => void;
  onAdd: (addr: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className={styles.recipRow}>
      <span className={styles.recipLabel}>{FIELD_LABEL[f]}</span>
      <div className={styles.chips}>
        {people.map((p) => (
          <span key={p.address} className={styles.chip}>
            <span
              className={styles.chipAvatar}
              style={{ background: avatarColor(p.address)[0], color: avatarColor(p.address)[1] }}
            >
              {initials(p)}
            </span>
            <span className={styles.chipName}>{p.name || p.address}</span>
            <button className={styles.chipX} onClick={() => onRemove(p.address)}>
              ×
            </button>
          </span>
        ))}
        <input
          className={styles.recipInput}
          placeholder="legg til …"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              onAdd(draft.trim());
              setDraft("");
            }
          }}
        />
      </div>
    </div>
  );
}

export interface ComposeSpec {
  to?: MailPerson[];
  subject?: string;
  body?: string;
}

// Redigerbart send-kort: mottaker forhåndsutfylt av AI-en, brukeren justerer og
// sender. Samme design som det tidligere svarforslaget, uten tråd-lesing.
export function MailCompose({ spec }: { spec: ComposeSpec }) {
  const [to, setTo] = useState<MailPerson[]>(spec.to ?? []);
  const [cc, setCc] = useState<MailPerson[]>([]);
  const [subject, setSubject] = useState(spec.subject ?? "");
  const [body, setBody] = useState(spec.body ?? "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (sending || sent || to.length === 0) return;
    setSending(true);
    setError(null);
    try {
      await sendMail({ to, cc, bcc: [], subject, body });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sending feilet");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className={styles.replyCard}>
        <div className={styles.sentBox}>Sendt ✓</div>
      </div>
    );
  }

  return (
    <div className={styles.replyCard}>
      <div className={styles.recips}>
        <ChipRow
          f="to"
          people={to}
          onRemove={(a) => setTo((v) => v.filter((p) => p.address !== a))}
          onAdd={(a) => setTo((v) => [...v, { name: "", address: a }])}
        />
        <ChipRow
          f="cc"
          people={cc}
          onRemove={(a) => setCc((v) => v.filter((p) => p.address !== a))}
          onAdd={(a) => setCc((v) => [...v, { name: "", address: a }])}
        />
      </div>
      <input
        className={styles.subject}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Emne"
      />
      <textarea
        className={styles.draft}
        value={body}
        rows={8}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Skriv meldingen …"
      />
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.sendRow}>
        <span className={styles.sigNote}>Signatur legges til automatisk</span>
        <button
          className={styles.sendBtn}
          onClick={send}
          disabled={sending || to.length === 0 || !body.trim()}
          title="Send"
          aria-label="Send"
        >
          <HugeiconsIcon icon={TelegramIcon} size={18} />
        </button>
      </div>
    </div>
  );
}
