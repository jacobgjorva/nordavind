import { useEffect, useRef, useState } from "react";
import {
  analyzeThread,
  deleteMailAccount,
  fetchInbox,
  fetchMailAccount,
  fetchThread,
  refineDraft,
  saveMailAccount,
  sendMail,
  type MailAccount,
  type MailAnalysis,
  type MailMessage,
  type MailPerson,
  type MailThreadSummary,
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

// ── Konto-oppsett ──
function AccountSetup({ onSaved }: { onSaved: () => void }) {
  const [f, setF] = useState({
    email: "",
    imap_host: "",
    imap_port: 993,
    smtp_host: "",
    smtp_port: 587,
    password: "",
    signature: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string | number) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await saveMailAccount(f);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Feil");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.setup}>
      <h2>Koble til e-post</h2>
      <p className={styles.setupHint}>
        Finn IMAP/SMTP-innstillingene i Apple Mail: Innstillinger → Kontoer →
        Serverinnstillinger. Bruk et app-passord om kontoen krever det.
      </p>
      <input className={styles.field} placeholder="E-post" value={f.email}
        onChange={(e) => set("email", e.target.value)} />
      <div className={styles.row2}>
        <input className={styles.field} placeholder="IMAP-host (imap.…)" value={f.imap_host}
          onChange={(e) => set("imap_host", e.target.value)} />
        <input className={styles.fieldSm} placeholder="993" value={f.imap_port}
          onChange={(e) => set("imap_port", Number(e.target.value) || 993)} />
      </div>
      <div className={styles.row2}>
        <input className={styles.field} placeholder="SMTP-host (smtp.…)" value={f.smtp_host}
          onChange={(e) => set("smtp_host", e.target.value)} />
        <input className={styles.fieldSm} placeholder="587" value={f.smtp_port}
          onChange={(e) => set("smtp_port", Number(e.target.value) || 587)} />
      </div>
      <input className={styles.field} type="password" placeholder="Passord / app-passord"
        value={f.password} onChange={(e) => set("password", e.target.value)} />
      <textarea className={styles.field} placeholder="Forretnings-signatur" rows={3}
        value={f.signature} onChange={(e) => set("signature", e.target.value)} />
      {err && <div className={styles.err}>{err}</div>}
      <button className={styles.primary} onClick={save} disabled={busy}>
        {busy ? "Kobler til …" : "Koble til"}
      </button>
    </div>
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
        {m.attachments.length > 0 && (
          <div className={styles.attaches}>
            {m.attachments.map((a, i) => (
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

// ── Trådvisning ──
function ThreadView({ thread, me }: { thread: MailThreadSummary; me: string }) {
  const [msgs, setMsgs] = useState<MailMessage[] | null>(null);
  const [analysis, setAnalysis] = useState<MailAnalysis | null>(null);
  const [recips, setRecips] = useState<Record<Field, MailPerson[]>>({ to: [], cc: [], bcc: [] });
  const [body, setBody] = useState("");
  const [feedback, setFeedback] = useState("");
  const [refining, setRefining] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setMsgs(null);
    setAnalysis(null);
    setSent(false);
    fetchThread(thread.key).then((r) => {
      setMsgs(r.messages);
      // Standard mottakere: svar til siste avsender, kopi til øvrige (ikke meg).
      const last = r.messages[r.messages.length - 1];
      const to = last ? [last.from] : [];
      const seen = new Set([me.toLowerCase(), ...to.map((p) => p.address.toLowerCase())]);
      const cc: MailPerson[] = [];
      r.messages.forEach((m) =>
        [...m.to, ...m.cc, m.from].forEach((p) => {
          const a = p.address.toLowerCase();
          if (a && !seen.has(a)) { seen.add(a); cc.push(p); }
        })
      );
      setRecips({ to, cc, bcc: [] });
    });
    analyzeThread(thread.key).then((a) => {
      setAnalysis(a);
      setBody(a.draft);
    }).catch(() => {});
  }, [thread.key, me]);

  const subject = thread.subject.match(/^\s*(re|sv|svar)\s*:/i)
    ? thread.subject
    : `Re: ${thread.subject}`;
  const last = msgs?.[msgs.length - 1];

  async function refine() {
    if (!feedback.trim()) return;
    setRefining(true);
    try {
      const d = await refineDraft(thread.key, body, feedback);
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
        <h2>{thread.subject}</h2>
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

// ── Rot: konto-sjekk → inbox + tråd ──
export function Mail() {
  const [account, setAccount] = useState<MailAccount | null | undefined>(undefined);
  const [threads, setThreads] = useState<MailThreadSummary[] | null>(null);
  const [selected, setSelected] = useState<MailThreadSummary | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  function loadInbox() {
    setThreads(null);
    setLoadErr(null);
    fetchInbox().then(setThreads).catch((e) => setLoadErr(e.message));
  }

  useEffect(() => {
    fetchMailAccount()
      .then((a) => {
        setAccount(a);
        if (a && !loadedOnce.current) {
          loadedOnce.current = true;
          loadInbox();
        }
      })
      .catch(() => setAccount(null));
  }, []);

  if (account === undefined) return <div className={styles.wrap} />;
  if (account === null)
    return (
      <div className={styles.wrap}>
        <AccountSetup onSaved={() => { setAccount(undefined); loadedOnce.current = false;
          fetchMailAccount().then((a) => { setAccount(a); if (a) { loadedOnce.current = true; loadInbox(); } }); }} />
      </div>
    );

  return (
    <div className={styles.wrap}>
      <div className={styles.inbox}>
        <div className={styles.inboxHead}>
          <span>Innboks</span>
          <button className={styles.iconBtn} onClick={loadInbox} title="Oppdater">⟳</button>
        </div>
        {loadErr && <div className={styles.err}>{loadErr}</div>}
        {threads === null ? (
          <div className={styles.loading}>Laster …</div>
        ) : (
          <div className={styles.threadList}>
            {threads.map((t) => (
              <button key={t.key}
                className={`${styles.threadItem} ${selected?.key === t.key ? styles.active : ""}`}
                onClick={() => setSelected(t)}>
                <Avatar p={t.from} />
                <div className={styles.tiBody}>
                  <div className={styles.tiTop}>
                    <span className={`${styles.tiFrom} ${t.unread ? styles.bold : ""}`}>
                      {t.from.name || t.from.address}
                    </span>
                    <span className={styles.tiDate}>{fmtDate(t.date)}</span>
                  </div>
                  <div className={`${styles.tiSubject} ${t.unread ? styles.bold : ""}`}>
                    {t.subject || "(uten emne)"}
                    {t.count > 1 && <span className={styles.tiCount}>{t.count}</span>}
                    {t.attach && <span className={styles.tiClip}>📎</span>}
                  </div>
                </div>
                {t.unread > 0 && <span className={styles.unreadDot} />}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={styles.detail}>
        {selected ? (
          <ThreadView key={selected.key} thread={selected} me={account.email} />
        ) : (
          <div className={styles.empty}>Velg en tråd</div>
        )}
      </div>
    </div>
  );
}

// Innstillinger-lenke for å koble fra (brukes evt. senere).
export async function disconnectMail() {
  await deleteMailAccount();
}
