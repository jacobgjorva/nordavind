import { useEffect, useState } from "react";
import {
  analyzeThread,
  fetchThread,
  refineDraft,
  sendMail,
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


// ── Mottaker-chips (klikk for å bytte felt, × for å fjerne) ──
type Field = "to" | "cc" | "bcc";
const FIELD_LABEL: Record<Field, string> = { to: "Til", cc: "Kopi", bcc: "Blindkopi" };

function Recipients({
  value,
  onChange,
}: {
  value: Record<Field, MailPerson[]>;
  onChange: (v: Record<Field, MailPerson[]>) => void;
}) {
  const [draft, setDraft] = useState("");
  const cycle = (from: Field, addr: string) => {
    const order: Field[] = ["to", "cc", "bcc"];
    const next = order[(order.indexOf(from) + 1) % 3];
    const v = { ...value };
    v[from] = v[from].filter((p) => p.address !== addr);
    const person = value[from].find((p) => p.address === addr)!;
    v[next] = [...v[next], person];
    onChange(v);
  };
  const remove = (f: Field, addr: string) =>
    onChange({ ...value, [f]: value[f].filter((p) => p.address !== addr) });
  const add = () => {
    const a = draft.trim();
    if (!a) return;
    onChange({ ...value, to: [...value.to, { name: "", address: a }] });
    setDraft("");
  };

  return (
    <div className={styles.recips}>
      {(["to", "cc", "bcc"] as Field[]).map((f) =>
        value[f].length ? (
          <div key={f} className={styles.recipRow}>
            <span className={styles.recipLabel}>{FIELD_LABEL[f]}</span>
            <div className={styles.chips}>
              {value[f].map((p) => (
                <span key={p.address} className={styles.chip}>
                  <button className={styles.chipMove} title="Bytt felt"
                    onClick={() => cycle(f, p.address)}>
                    {p.name || p.address}
                  </button>
                  <button className={styles.chipX} onClick={() => remove(f, p.address)}>×</button>
                </span>
              ))}
            </div>
          </div>
        ) : null
      )}
      <div className={styles.recipRow}>
        <span className={styles.recipLabel}>+</span>
        <input className={styles.recipInput} placeholder="Legg til mottaker …"
          value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
      </div>
    </div>
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
export function MailThread({ threadKey }: { threadKey: string }) {
  const [msgs, setMsgs] = useState<MailMessage[] | null>(null);
  const [analysis, setAnalysis] = useState<MailAnalysis | null>(null);
  const [recips, setRecips] = useState<Record<Field, MailPerson[]>>({ to: [], cc: [], bcc: [] });
  const [body, setBody] = useState("");
  const [feedback, setFeedback] = useState("");
  const [refining, setRefining] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [threadSubject, setThreadSubject] = useState("");

  useEffect(() => {
    let alive = true;
    fetchThread(threadKey).then((r) => {
      if (!alive) return;
      setMsgs(r.messages);
      const first = r.messages[0];
      if (first) setThreadSubject(first.subject.replace(/^\s*(re|sv|svar)\s*:\s*/i, ""));
      // Standard mottakere: svar til siste avsender, kopi til øvrige (ikke meg).
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
    analyzeThread(threadKey).then((a) => {
      if (!alive) return;
      setAnalysis(a);
      setBody(a.draft);
    }).catch(() => {});
    return () => { alive = false; };
  }, [threadKey]);

  const subject = `Re: ${threadSubject}`;
  const last = msgs?.[msgs.length - 1];

  async function refine() {
    if (!feedback.trim()) return;
    setRefining(true);
    try {
      const d = await refineDraft(threadKey, body, feedback);
      setBody(d);
      setFeedback("");
    } finally {
      setRefining(false);
    }
  }

  async function send() {
    setSending(true);
    try {
      await sendMail({
        to: recips.to, cc: recips.cc, bcc: recips.bcc,
        subject, body,
        in_reply_to: last?.message_id,
        references: last?.message_id,
      });
      setSent(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Sending feilet");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.thread}>
      <div className={styles.threadHead}>
        <h2>{threadSubject || "…"}</h2>
      </div>
      {analysis?.summary && <div className={styles.summary}>{analysis.summary}</div>}

      <div className={styles.msgs}>
        {msgs === null ? (
          <div className={styles.loading}>Laster tråd …</div>
        ) : (
          msgs.map((m, i) => (
            <ThreadMessage key={m.uid} m={m} essence={analysis?.essences?.[i]} />
          ))
        )}
      </div>

      {sent ? (
        <div className={styles.sentBox}>Sendt ✓</div>
      ) : (
        <div className={styles.composer}>
          <Recipients value={recips} onChange={setRecips} />
          <div className={styles.subject}>{subject}</div>
          <textarea className={styles.draft} value={body} rows={7}
            onChange={(e) => setBody(e.target.value)}
            placeholder={analysis ? "" : "AI skriver et forslag …"} />
          <div className={styles.feedbackRow}>
            <input className={styles.feedback} value={feedback}
              placeholder="Be AI justere svaret (f.eks. «kortere, mer formell») …"
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); refine(); } }} />
            <button className={styles.ghost} onClick={refine} disabled={refining || !feedback.trim()}>
              {refining ? "…" : "Juster"}
            </button>
          </div>
          <div className={styles.sendRow}>
            <span className={styles.sigNote}>Signatur legges til automatisk</span>
            <button className={styles.primary} onClick={send} disabled={sending || !body.trim()}>
              {sending ? "Sender …" : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
