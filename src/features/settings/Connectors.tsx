import { useEffect, useState } from "react";
import chatStyles from "../chat/Chat.module.css";
import {
  createConnection,
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

const DRIVER_MAP: Record<string, { key: string; port: number; user: string }> = {
  PostgreSQL: { key: "postgres", port: 5432, user: "postgres" },
  MySQL: { key: "mysql", port: 3306, user: "root" },
  "SQL Server": { key: "mssql", port: 1433, user: "sa" },
};

// Predefinert skript for database-flyten: ett felt om gangen, med
// naturlige forslag i komboboksen. Ingen AI = ingen tokens.
interface FlowStep {
  key: string;
  question: string;
  options: (answers: Record<string, string>) => string[];
  secret?: boolean;
}

const DB_FLOW: FlowStep[] = [
  {
    key: "driver",
    question: "Hvilken databasetype?",
    options: () => Object.keys(DRIVER_MAP),
  },
  {
    key: "name",
    question: "Hva skal tilkoblingen hete?",
    options: () => ["Regnskap", "CRM", "Salg", "Lager"],
  },
  {
    key: "host",
    question: "Hvilken host kjører databasen på?",
    options: () => ["localhost"],
  },
  {
    key: "port",
    question: "Hvilken port?",
    options: (a) => [String(DRIVER_MAP[a.driver]?.port ?? 5432)],
  },
  {
    key: "database",
    question: "Hva heter databasen?",
    options: () => [],
  },
  {
    key: "user",
    question: "Hvilket brukernavn skal jeg logge inn med?",
    options: (a) => [DRIVER_MAP[a.driver]?.user ?? "postgres"].filter(Boolean),
  },
  {
    key: "password",
    question: "Og passordet? (lagres kryptert)",
    options: () => [],
    secret: true,
  },
];

interface LogMsg {
  id: number;
  role: "bot" | "user";
  text: string;
}

let logId = 0;

function ChatWizard(_props: {
  initialConn: Connection | null;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  const [hilite, setHilite] = useState(0);
  const [log, setLog] = useState<LogMsg[]>([]);
  // stage: -1 = kildevalg, 0..n = DB_FLOW-steg, 100 = kobler til, 101 = ferdig
  const [stage, setStage] = useState(-1);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const question =
    stage === -1
      ? "Hva skal vi koble til?"
      : stage < DB_FLOW.length
        ? DB_FLOW[stage].question
        : null;

  const rawOptions =
    stage === -1
      ? SOURCE_OPTIONS
      : stage >= 0 && stage < DB_FLOW.length
        ? DB_FLOW[stage].options(answers)
        : [];
  const options = rawOptions.filter((o) =>
    o.toLowerCase().includes(input.trim().toLowerCase())
  );

  function say(role: "bot" | "user", text: string) {
    setLog((prev) => [...prev, { id: ++logId, role, text }]);
  }

  async function connect(a: Record<string, string>) {
    setStage(100);
    say("bot", "Tester tilkoblingen …");
    try {
      const conn = await createConnection({
        name: a.name,
        driver: DRIVER_MAP[a.driver]?.key ?? "postgres",
        host: a.host,
        port: Number(a.port) || 5432,
        database: a.database,
        user: a.user,
        password: a.password ?? "",
      });
      say("bot", `Tilkoblet! ${conn.name} er lagret. Neste steg kommer snart.`);
      setStage(101);
    } catch (err) {
      say("bot", (err instanceof Error ? err.message : "Kunne ikke koble til.") + " Prøv passordet igjen.");
      setStage(DB_FLOW.length - 1);
    }
  }

  function answer(text: string) {
    if (!text.trim()) return;
    const value = text.trim();

    if (stage === -1) {
      if (value !== "Database" && !SOURCE_OPTIONS.includes(value)) {
        // Custom tekst: her skal en AI-agent inn senere.
        say("user", value);
        say("bot", "Det forstår jeg ikke helt ennå — velg en kilde fra listen.");
        setInput("");
        setHilite(0);
        return;
      }
      say("user", value);
      if (value !== "Database") {
        say("bot", `${value} kommer snart — foreløpig støtter vi Database.`);
        setInput("");
        setHilite(0);
        return;
      }
      setStage(0);
      setInput("");
      setHilite(0);
      return;
    }

    if (stage >= 0 && stage < DB_FLOW.length) {
      const step = DB_FLOW[stage];
      say("user", step.secret ? "••••••••" : value);
      const next = { ...answers, [step.key]: value };
      setAnswers(next);
      setInput("");
      setHilite(0);
      if (stage + 1 < DB_FLOW.length) {
        setStage(stage + 1);
      } else {
        connect(next);
      }
    }
  }

  function pick(option: string) {
    answer(option);
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
      if (input.trim()) answer(input);
      else if (options.length > 0) answer(options[hilite]);
    }
  }

  return (
    <div className={styles.createPage}>
      <div className={styles.sectionTitle}>Opprett kobling</div>
      <div className={styles.canvas}>
        <div className={styles.canvasCenter}>
          {log.map((m) => (
            <div
              key={m.id}
              className={m.role === "bot" ? styles.canvasQuestion : styles.canvasChoice}
            >
              {m.text}
            </div>
          ))}
          {question && (
            <div className={styles.canvasQuestion} key={`q-${stage}`}>
              <FadeText text={question} />
            </div>
          )}
        </div>
      </div>
      <div className={chatStyles.composerDocked}>
        <div className={chatStyles.composerWrap}>
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
            {options.length > 0 && stage < DB_FLOW.length && (
              <div className={styles.comboBody}>
                <div className={styles.comboLabel}>
                  {stage === -1 ? "Kilder" : "Forslag"}
                </div>
                {options.map((o, i) => (
                  <button
                    key={o}
                    type="button"
                    className={`${styles.comboItem} ${i === hilite ? styles.comboItemActive : ""}`}
                    onMouseEnter={() => setHilite(i)}
                    onClick={() => pick(o)}
                  >
                    <span className={styles.comboDot} />
                    <span className={styles.comboItemLabel}>{o}</span>
                  </button>
                ))}
              </div>
            )}
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
