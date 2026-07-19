import { useEffect, useState } from "react";
import {
  analyzeThread,
  fetchThread,
  type MailAnalysis,
  type MailMessage,
  type MailPerson,
} from "../../lib/api";
import styles from "./Mail.module.css";

// Deterministisk avatar-farge fra e-postadresse.
function avatarColor(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) % 360;
  return `hsl(${h}, 42%, 42%)`;
}

function initials(p: MailPerson): string {
  const src = (p.name || p.address).trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("no-NO", { day: "2-digit", month: "short" });
}

function Avatar({ p }: { p: MailPerson }) {
  return (
    <span className={styles.avatar} style={{ background: avatarColor(p.address) }}>
      {initials(p)}
    </span>
  );
}



// ── Én melding i tråden ──
function ThreadMessage({ m, essence }: { m: MailMessage; essence?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.msg}>
      <Avatar p={m.from} />
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
    }).catch(() => {});
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
