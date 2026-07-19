import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { TelegramIcon } from "@hugeicons/core-free-icons";
import {
  analyzeThread,
  fetchThread,
  refineDraft,
  sendMail,
  type MailAnalysis,
  type MailMessage,
  type MailPerson,
} from "../../lib/api";
import { emit, on } from "../../lib/events";
import { swallow } from "../../lib/log";
import styles from "./Mail.module.css";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("no-NO", { day: "2-digit", month: "short" });
}

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

// ── Én melding i tråden ──
function ThreadMessage({ m, essence }: { m: MailMessage; essence?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.msg}>
      <div className={styles.msgBody}>
        <div className={styles.msgHead}>
          <span className={styles.msgFrom}>{m.from.name || m.from.address}</span>
          <span className={styles.msgDate}>{fmtDate(m.date)}</span>
        </div>
        <div className={styles.essence}>{essence || "…"}</div>
        {(m.attachments ?? []).length > 0 && (
          <div className={styles.attaches}>
            {(m.attachments ?? []).map((a, i) => (
              <span key={i} className={styles.attach}>📎 {a.filename}</span>
            ))}
          </div>
        )}
        <button className={styles.toggle} onClick={() => setOpen((o) => !o)}>
          {open ? "Skjul original" : "Vis original"}
        </button>
        {open && <pre className={styles.original}>{m.body}</pre>}
      </div>
    </div>
  );
}

// ── Trådvisning (embeddes inline i chatten) ──
// Rent samtale-kort: emne, AI-sammendrag og oppsummert samtale. Svaret
// finpusses via den vanlige chat-inputen under.
export function MailThread({ threadKey }: { threadKey: string }) {
  const [msgs, setMsgs] = useState<MailMessage[] | null>(null);
  const [analysis, setAnalysis] = useState<MailAnalysis | null>(null);
  const [threadSubject, setThreadSubject] = useState("");

  useEffect(() => {
    let alive = true;
    fetchThread(threadKey).then((r) => {
      if (!alive) return;
      setMsgs(r.messages);
      const first = r.messages[0];
      if (first) setThreadSubject(first.subject.replace(/^\s*(re|sv|svar)\s*:\s*/i, ""));
    });
    analyzeThread(threadKey).then((a) => {
      if (!alive) return;
      setAnalysis(a);
    }).catch(swallow);
    return () => { alive = false; };
  }, [threadKey]);

  return (
    <div className={styles.thread}>
      <div className={styles.threadHead}>
        <h2>{threadSubject || "…"}</h2>
      </div>

      <div className={styles.msgs}>
        {msgs === null ? (
          <div className={styles.loading}>Laster tråd …</div>
        ) : (
          msgs.map((m, i) => (
            <ThreadMessage key={m.uid} m={m} essence={analysis?.essences?.[i]} />
          ))
        )}
      </div>
    </div>
  );
}

// ── Mottaker-chips med avatar (× for å fjerne, + for å legge til) ──
type Field = "to" | "cc" | "bcc";
const FIELD_LABEL: Record<Field, string> = { to: "Til", cc: "Kopi", bcc: "Blindkopi" };

function ChipRow({ f, people, onRemove, onAdd }: {
  f: Field;
  people: MailPerson[];
  onRemove: (addr: string) => void;
  onAdd?: (addr: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className={styles.recipRow}>
      <span className={styles.recipLabel}>{FIELD_LABEL[f]}</span>
      <div className={styles.chips}>
        {people.map((p) => (
          <span key={p.address} className={styles.chip}>
            <span className={styles.chipAvatar}
              style={{ background: avatarColor(p.address)[0], color: avatarColor(p.address)[1] }}>
              {initials(p)}
            </span>
            <span className={styles.chipName}>{p.name || p.address}</span>
            <button className={styles.chipX} onClick={() => onRemove(p.address)}>×</button>
          </span>
        ))}
        {onAdd && (
          <input className={styles.recipInput} placeholder="legg til …"
            value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) { e.preventDefault(); onAdd(draft.trim()); setDraft(""); }
            }} />
        )}
      </div>
    </div>
  );
}

function Recipients({
  value,
  onChange,
}: {
  value: Record<Field, MailPerson[]>;
  onChange: (v: Record<Field, MailPerson[]>) => void;
}) {
  const remove = (f: Field, addr: string) =>
    onChange({ ...value, [f]: value[f].filter((p) => p.address !== addr) });
  const add = (f: Field, a: string) =>
    onChange({ ...value, [f]: [...value[f], { name: "", address: a }] });
  return (
    <div className={styles.recips}>
      <ChipRow f="to" people={value.to} onRemove={(a) => remove("to", a)} onAdd={(a) => add("to", a)} />
      <ChipRow f="cc" people={value.cc} onRemove={(a) => remove("cc", a)} onAdd={(a) => add("cc", a)} />
    </div>
  );
}

// ── Svarforslag med Send. Justering skjer via hoved-chatten: den sender et
// «nordavind:mail-refine»-event som dette kortet lytter på. ──
export function MailReply({ threadKey }: { threadKey: string }) {
  const [msgs, setMsgs] = useState<MailMessage[] | null>(null);
  const [recips, setRecips] = useState<Record<Field, MailPerson[]>>({ to: [], cc: [], bcc: [] });
  const [subjectBase, setSubjectBase] = useState("");
  const [body, setBody] = useState("");
  const [refining, setRefining] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchThread(threadKey).then((r) => {
      if (!alive) return;
      setMsgs(r.messages);
      const first = r.messages[0];
      if (first) setSubjectBase(first.subject.replace(/^\s*(re|sv|svar)\s*:\s*/i, ""));
      const last = r.messages[r.messages.length - 1];
      const to = last ? [last.from] : [];
      const seen = new Set([r.me.toLowerCase(), ...to.map((p) => p.address.toLowerCase())]);
      const cc: MailPerson[] = [];
      r.messages.forEach((m) =>
        [...(m.to ?? []), ...(m.cc ?? []), m.from].forEach((p) => {
          const a = p.address.toLowerCase();
          if (a && !seen.has(a)) { seen.add(a); cc.push(p); }
        })
      );
      setRecips({ to, cc, bcc: [] });
    });
    analyzeThread(threadKey).then((a) => { if (alive) setBody(a.draft); }).catch(swallow);
    return () => { alive = false; };
  }, [threadKey]);

  // Justering fra hoved-chatten.
  useEffect(
    () =>
      on("mail-refine", async (d) => {
        if (d.key !== threadKey) return;
        const started = performance.now();
        setRefining(true);
        try {
          const next = await refineDraft(threadKey, body, d.feedback);
          // Glansen kjører til det nye utkastet er satt, og minst én full sveip.
          const wait = Math.max(0, 1300 - (performance.now() - started));
          await new Promise((r) => setTimeout(r, wait));
          setBody(next);
        } finally {
          setRefining(false);
        }
      }),
    [threadKey, body]
  );

  const subject = `Re: ${subjectBase}`;
  const last = msgs?.[msgs.length - 1];

  async function send() {
    setSending(true);
    try {
      await sendMail({
        to: recips.to, cc: recips.cc, bcc: recips.bcc,
        subject, body,
        in_reply_to: last?.message_id, references: last?.message_id,
      });
      setSent(true);
      emit("mail-sent", { key: threadKey });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Sending feilet");
    } finally {
      setSending(false);
    }
  }

  if (sent)
    return <div className={styles.replyCard}><div className={styles.sentBox}>Sendt ✓</div></div>;

  return (
    <div className={styles.replyCard}>
      {refining && <div className={styles.sheen} />}
      <Recipients value={recips} onChange={setRecips} />
      <div className={styles.subject}>{subject}</div>
      <textarea className={styles.draft} value={refining ? "" : body} rows={8}
        onChange={(e) => setBody(e.target.value)} readOnly={refining}
        placeholder={refining || body ? "" : "AI skriver et forslag …"} />
      <div className={styles.sendRow}>
        <span className={styles.sigNote}>
          {refining ? "AI justerer …" : "Signatur legges til automatisk"}
        </span>
        <button className={styles.sendBtn} onClick={send} disabled={sending || !body.trim()}
          title="Send" aria-label="Send">
          <HugeiconsIcon icon={TelegramIcon} size={18} />
        </button>
      </div>
    </div>
  );
}
