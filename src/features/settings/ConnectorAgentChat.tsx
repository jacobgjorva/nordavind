import { useRef, useState } from "react";
import chatStyles from "../chat/Chat.module.css";
import styles from "./ChatWizard.module.css";
import { Logo } from "../../ui/Logo";
import { fetchM365Status, streamChat, type ApiMessage } from "../../lib/api";

interface Msg {
  id: number;
  role: "bot" | "user";
  text: string;
}

let seq = 0;

// Connector-agenten: ren agent-chat, ingen skriptet flyt. Agenten vet hva som
// er støttet, samler det den trenger og oppretter tilkoblingen via verktøy.
export function ConnectorAgentChat({ onCreated }: { onCreated: () => void }) {
  const [log, setLog] = useState<Msg[]>([
    { id: seq++, role: "bot", text: "Hva vil du koble til?" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Innloggings-URL fra agenten: nettlesere blokkerer window.open utenfor
  // klikk-kontekst, så vi viser alltid en knapp brukeren kan klikke selv.
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  // Full samtalehistorikk til modellen (inkl. det brukeren skrev).
  const historyRef = useRef<ApiMessage[]>([
    { role: "assistant", content: "Hva vil du koble til?" },
  ]);

  function say(role: "bot" | "user", text: string) {
    setLog((l) => [...l, { id: seq++, role, text }]);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    say("user", text);
    historyRef.current.push({ role: "user", content: text });
    setBusy(true);
    setStatus("Tenker");
    let acc = "";
    try {
      await streamChat(
        "auto",
        historyRef.current,
        (delta) => {
          if (delta.step) setStatus(delta.step);
          if (delta.m365Auth) {
            setAuthUrl(delta.m365Auth);
            window.open(delta.m365Auth, "_blank", "width=520,height=680");
            // Fang fullført innlogging: bekreft i chatten og oppdater lista.
            const t = window.setInterval(async () => {
              const st = await fetchM365Status().catch(() => null);
              if (st?.connected) {
                window.clearInterval(t);
                setAuthUrl(null);
                say("bot", `Microsoft 365 er koblet til som ${st.email} ✓`);
                historyRef.current.push({
                  role: "assistant",
                  content: `Microsoft 365 er koblet til som ${st.email}.`,
                });
                onCreated();
              }
            }, 2000);
            window.setTimeout(() => window.clearInterval(t), 180000);
          }
          if (delta.connectionCreated) onCreated();
          if (delta.content) acc += delta.content;
        },
        undefined,
        { connector: true }
      );
      const reply = acc.trim() || "Noe gikk galt — prøv igjen.";
      historyRef.current.push({ role: "assistant", content: reply });
      say("bot", reply);
    } catch {
      say("bot", "Noe gikk galt — prøv igjen.");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <div className={styles.createPage}>
      <div className={styles.canvasCenter}>
        {log.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "bot" ? styles.canvasQuestion : styles.canvasChoice
            }
          >
            {m.text}
          </div>
        ))}
        {authUrl && (
          <a
            className={styles.authButton}
            href={authUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              /* ekte klikk → popup-blokkering biter ikke */
            }}
          >
            Åpne Microsoft-innlogging
          </a>
        )}
        {status && (
          <div className={chatStyles.step}>
            <span className={chatStyles.thinkingLogo}>
              <Logo size={10} flutter glow="#ffffff" />
            </span>
            <span className={chatStyles.stepActive}>{status} …</span>
          </div>
        )}
      </div>
      <div className={chatStyles.composerDocked}>
        <div className={chatStyles.composerWrap}>
          <div className={chatStyles.composer}>
            <div className={chatStyles.inputRow}>
              <textarea
                className={chatStyles.input}
                rows={1}
                placeholder={busy ? "Vent litt …" : "F.eks. «koble til Postgres-basen vår» …"}
                value={input}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
            </div>
            <div className={chatStyles.footer}>
              <span className={chatStyles.sendHint}>
                Send <span className={chatStyles.kbd}>↵</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
