import { useEffect, useState } from "react";
import chatStyles from "../chat/Chat.module.css";
import {
  deleteConnection,
  fetchConnections,
  type Connection,
} from "../../lib/api";
import styles from "./Connectors.module.css";

const DB_TYPES = [
  { key: "postgres", label: "PostgreSQL", port: 5432 },
  { key: "mysql", label: "MySQL", port: 3306 },
  { key: "mssql", label: "SQL Server", port: 1433 },
];

export function Connectors() {
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canvas, setCanvas] = useState<{ conn: Connection | null } | null>(null);

  function reload() {
    fetchConnections()
      .then(setConns)
      .catch(() => setError("Kunne ikke hente tilkoblinger."));
  }

  useEffect(reload, []);

  async function remove(conn: Connection) {
    if (!confirm(`Fjerne tilkoblingen ${conn.name}?`)) return;
    try {
      await deleteConnection(conn.id);
      reload();
    } catch {
      setError("Kunne ikke fjerne tilkoblingen.");
    }
  }

  if (error && !conns) return <div className={styles.error}>{error}</div>;
  if (!conns) return null;

  // Ny tilkobling tar over hele siden.
  if (canvas) {
    return (
      <ChatWizard
        initialConn={canvas.conn}
        onClose={() => {
          setCanvas(null);
          reload();
        }}
      />
    );
  }

  return (
    <div className={styles.content}>
      <div className={styles.section}>
        <div className={styles.head}>
          <div className={styles.sectionTitle}>Databaser</div>
          <button className={styles.primary} onClick={() => setCanvas({ conn: null })}>
            Ny tilkobling
          </button>
        </div>
        <div className={styles.sectionDesc}>
          Koble til bedriftens egne databaser og velg hva AI-en får se.
        </div>

        {conns.length === 0 && (
          <div className={styles.empty}>Ingen tilkoblinger ennå.</div>
        )}
        {conns.map((c) => (
          <div key={c.id} className={styles.connRow} onClick={() => setCanvas({ conn: c })}>
            <span className={styles.connName}>{c.name}</span>
            <span className={styles.connDriver}>
              {DB_TYPES.find((t) => t.key === c.driver)?.label ?? c.driver}
            </span>
            <button
              className={styles.remove}
              onClick={(e) => {
                e.stopPropagation();
                remove(c);
              }}
            >
              Fjern
            </button>
          </div>
        ))}
        {error && <div className={styles.error}>{error}</div>}
      </div>
    </div>
  );
}

// Canvas som åpnes ved «Ny tilkobling» — innholdet bygges videre senere.
// Ord-for-ord fade-in, samme animasjon som hovedchatten.
function FadeText({ text }: { text: string }) {
  const words = text.match(/\S+\s*/g) ?? [];
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (visible >= words.length) return;
    const t = setTimeout(() => setVisible((v) => v + 1), 120);
    return () => clearTimeout(t);
  }, [visible, words.length]);

  return (
    <span className={chatStyles.streamingText}>
      {words.slice(0, visible).map((w, i) => (
        <span key={i} className={chatStyles.fadeSeg}>
          {w}
        </span>
      ))}
    </span>
  );
}

const SOURCE_OPTIONS = ["Database", "Databricks", "CSV", "Excel", "Cloud Storage"];

function ChatWizard(_props: {
  initialConn: Connection | null;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const [hilite, setHilite] = useState(0);

  const options = SOURCE_OPTIONS.filter((o) =>
    o.toLowerCase().includes(input.trim().toLowerCase())
  );

  function pick(option: string) {
    setChoice(option);
    setInput("");
    setHilite(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHilite((h) => Math.min(h + 1, options.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHilite((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!choice && options.length > 0) pick(options[hilite]);
      else setInput("");
    }
  }

  return (
    <div className={styles.createPage}>
      <div className={styles.sectionTitle}>Opprett kobling</div>
      <div className={styles.canvas}>
        <div className={styles.canvasCenter}>
          <div className={styles.canvasQuestion}>
            <FadeText text="Hva skal vi koble til?" />
          </div>
          {choice && <div className={styles.canvasChoice}>{choice}</div>}
        </div>
      </div>
      <div className={chatStyles.composerDocked}>
        <div className={`${chatStyles.composerWrap} ${styles.composerAnchor}`}>
          {!choice && options.length > 0 && (
            <div className={styles.palette}>
              {options.map((o, i) => (
                <button
                  key={o}
                  type="button"
                  className={`${styles.paletteItem} ${i === hilite ? styles.paletteActive : ""}`}
                  onMouseEnter={() => setHilite(i)}
                  onClick={() => pick(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          <div className={chatStyles.composer}>
            <div className={chatStyles.inputRow}>
              <textarea
                className={chatStyles.input}
                rows={1}
                placeholder="Spør om hva som helst …"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
            </div>
            <div className={chatStyles.footer}>
              <span className={chatStyles.modelInfo}>Modell: Bris</span>
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
