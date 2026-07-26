import { useRef, useState } from "react";
import { BASE_URL, getToken, sendMail, type MailPerson } from "../../lib/api";
import { avatarColor, initials as avatarInitials } from "../../ui/avatar";
import { FileTag } from "../../ui/FileTag";
import styles from "./MailCompose.module.css";

function initials(p: MailPerson): string {
  return avatarInitials(p.name, p.address);
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

async function downloadAttachment(id: string, name: string) {
  const resp = await fetch(`${BASE_URL}/mail/attachments/${id}?format=xlsx`, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export interface ComposeAttachment {
  id: string;
  name: string;
  rows?: number;
}

export interface ComposeSpec {
  to?: MailPerson[];
  subject?: string;
  body?: string;
  attachments?: ComposeAttachment[];
}

// Redigerbart send-kort: mottaker forhåndsutfylt av AI-en, brukeren justerer og
// sender. Samme design som det tidligere svarforslaget, uten tråd-lesing.
export function MailCompose({ spec }: { spec: ComposeSpec }) {
  const [to, setTo] = useState<MailPerson[]>(spec.to ?? []);
  const [cc, setCc] = useState<MailPerson[]>([]);
  const [subject, setSubject] = useState(spec.subject ?? "");
  const bodyRef = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(!(spec.body ?? "").trim());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (sending || sent || to.length === 0 || empty) return;
    setSending(true);
    setError(null);
    const el = bodyRef.current;
    const text = el?.innerText ?? "";
    const html = el?.innerHTML ?? "";
    try {
      await sendMail({
        to, cc, bcc: [], subject, body: text, body_html: html,
        attachment_ids: (spec.attachments ?? []).map((a) => a.id),
      });
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
      <div className={styles.recipRow}>
        <span className={styles.recipLabel}>Emne</span>
        <input
          className={styles.subjectInput}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Emne …"
        />
      </div>
      <div
        ref={bodyRef}
        className={styles.editor}
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Skriv meldingen …"
        onInput={() => setEmpty(!(bodyRef.current?.innerText ?? "").trim())}
        dangerouslySetInnerHTML={{ __html: (spec.body ?? "").replace(/\n/g, "<br/>") }}
      />
      {(spec.attachments ?? []).length > 0 && (
        <div className={styles.attachRow}>
          {(spec.attachments ?? []).map((a) => (
            <FileTag
              key={a.id}
              name={a.name}
              meta={a.rows ? `${a.rows} rader` : undefined}
              onClick={() => downloadAttachment(a.id, a.name)}
              title="Klikk for å laste ned og sjekke fila"
            />
          ))}
        </div>
      )}
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.toolbar}>
        <span className={styles.toolFont}>Inter</span>
        <select
          className={styles.toolSize}
          defaultValue="3"
          onChange={(e) => document.execCommand("fontSize", false, e.target.value)}
        >
          <option value="2">12px</option>
          <option value="3">14px</option>
          <option value="4">16px</option>
        </select>
        <label className={styles.toolColor} title="Tekstfarge">
          <input
            type="color"
            defaultValue="#eeeeee"
            onChange={(e) => document.execCommand("foreColor", false, e.target.value)}
          />
        </label>
        <span className={styles.toolGroup}>
          <button className={styles.toolBtn} onMouseDown={(e) => { e.preventDefault(); document.execCommand("bold"); }}><b>B</b></button>
          <button className={styles.toolBtn} onMouseDown={(e) => { e.preventDefault(); document.execCommand("italic"); }}><i>I</i></button>
          <button className={styles.toolBtn} onMouseDown={(e) => { e.preventDefault(); document.execCommand("underline"); }}><u>U</u></button>
        </span>
        <button
          className={styles.sendBtn}
          onClick={send}
          disabled={sending || to.length === 0 || empty}
        >
          {sending ? "Sender …" : "Send"}
        </button>
      </div>
    </div>
  );
}
