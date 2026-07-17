import { useEffect, useState } from "react";
import chatStyles from "../chat/Chat.module.css";
import { Logo } from "../../ui/Logo";
import {
  completeChat,
  createConnection,
  deleteConnection,
  fetchConnections,
  fetchConnectionSchema,
  type Connection,
  type ConnectionSchema,
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
  const [sourceChosen, setSourceChosen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // Felt under korrigering — overstyrer den lineære rekkefølgen.
  const [editKey, setEditKey] = useState<string | null>(null);
  const [savedConn, setSavedConn] = useState<Connection | null>(null);
  const [schema, setSchema] = useState<ConnectionSchema | null>(null);
  const [selTables, setSelTables] = useState<Set<string>>(new Set());
  const [tablesDone, setTablesDone] = useState(false);
  const [busy, setBusy] = useState(false);
  // Pågående handling: vises med logo-animasjon som i hovedchatten.
  const [status, setStatus] = useState<string | null>(null);

  // Aktivt felt utledes av svarene: eksplisitt korrigering vinner, ellers
  // første ubesvarte felt. Alt besvart -> null (klar/tilkoblet).
  const activeStep: FlowStep | null = !sourceChosen
    ? null
    : (editKey && DB_FLOW.find((f) => f.key === editKey)) ||
      DB_FLOW.find((f) => !(f.key in answers)) ||
      null;

  const tablesPhase = Boolean(savedConn && schema && !tablesDone && !activeStep);

  const question = !sourceChosen
    ? "Hva skal vi koble til?"
    : activeStep?.question ??
      (tablesPhase ? "Hvilke bord skal AI-en få bruke?" : null);

  const DONE_ITEM = "__done__";
  const rawOptions = !sourceChosen
    ? SOURCE_OPTIONS
    : activeStep
      ? activeStep.options(answers)
      : tablesPhase && schema
        ? schema.tables.map((t) => t.name)
        : [];
  const filtered = rawOptions.filter((o) =>
    o.toLowerCase().includes(input.trim().toLowerCase())
  );
  // Bordvalg: maks 5 treff om gangen + Ferdig-element når noe er valgt.
  const options = tablesPhase
    ? [
        ...(selTables.size > 0 ? [DONE_ITEM] : []),
        ...filtered.slice(0, 5),
      ]
    : filtered;

  function say(role: "bot" | "user", text: string) {
    setLog((prev) => [...prev, { id: ++logId, role, text }]);
  }

  async function connect(a: Record<string, string>) {
    if (busy) return;
    setBusy(true);
    setStatus("Tester tilkoblingen");
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
      // Korrigering etter vellykket oppkobling: den nye erstatter den gamle.
      if (savedConn) await deleteConnection(savedConn.id).catch(() => {});
      setSavedConn(conn);
      setStatus("Henter skjemaet");
      const sch = await fetchConnectionSchema(conn.id);
      setSchema(sch);
      setStatus(null);
      say("bot", `Tilkoblet! Jeg fant ${sch.tables.length} bord i databasen.`);
    } catch (err) {
      setStatus(null);
      say("bot", (err instanceof Error ? err.message : "Kunne ikke koble til.") + " Prøv passordet igjen.");
      setAnswers((prev) => {
        const next = { ...prev };
        delete next.password;
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  function acceptAnswer(step: FlowStep, value: string) {
    const next = { ...answers, [step.key]: value };
    setAnswers(next);
    setEditKey(null);
    // Alt besvart? Da (re)kobler vi.
    if (DB_FLOW.every((f) => f.key in next)) {
      connect(next);
    }
  }

  // Fritekst som ikke matcher et forslag: agenten tolker svaret i kontekst
  // og bestemmer om det er et gyldig feltsvar eller trenger oppfølging.
  async function askAgent(step: FlowStep | null, value: string) {
    setStatus("Tenker");
    try {
      const strictNote =
        step?.key === "driver"
          ? ` Feltet har FASTE gyldige verdier: ${Object.keys(DRIVER_MAP).join(", ")}. accept=true KUN hvis svaret entydig er en av disse (value = eksakt verdi fra listen). Andre databasetyper støttes ikke.`
          : "";
      const context =
        step === null
          ? `Brukeren velger datakilde. Gyldige valg: ${SOURCE_OPTIONS.join(", ")}. Kun Database er støttet foreløpig.`
          : `Spørsmålet til brukeren var: "${step.question}" (felt: ${step.key} i en databasetilkobling).` + strictNote;
      const fields = DB_FLOW.map((f) => f.key).join(", ");
      const answered = Object.entries(answers)
        .filter(([k]) => k !== "password")
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      const raw = await completeChat("bris", [
        {
          role: "system",
          content:
            "Du hjelper en bruker å sette opp en databasetilkobling, felt for felt. " +
            context +
            (answered ? ` Allerede besvart: ${answered}.` : "") +
            ' Vurder brukerens svar. Svar KUN med JSON: {"accept": true/false, "value": "<feltverdien>", "goto": "<feltnavn eller null>", "reply": "<kort norsk melding>"}. ' +
            "accept=true hvis svaret kan brukes som verdi for feltet (value = normalisert verdi). " +
            "For frie felter (name, host, database, user) er ethvert rimelig ord eller navn gyldig — aksepter det som det er. " +
            "accept=false KUN hvis svaret åpenbart er tastetull, et spørsmål, eller en instruks om noe annet. " +
            'Eksempler (felt name): "Flyttest" -> {"accept":true,"value":"Flyttest","goto":null,"reply":""}. ' +
            '"Regnskapsbasen vår" -> {"accept":true,"value":"Regnskapsbasen","goto":null,"reply":""}. ' +
            '"asdkjhasd" -> {"accept":false,"goto":null,"reply":"Det ser ut som tastetull - gi tilkoblingen et beskrivende navn."}. ' +
            '"vent, jeg vil bytte databasetype" -> {"accept":false,"goto":"driver","reply":"Ok, vi tar databasetypen på nytt."}. ' +
            `Hvis brukeren vil endre et TIDLIGERE felt (${fields}), sett goto til det feltet. ` +
            'Hvis brukeren vil endre selve datakilden (angrer på valget Database/CSV osv., eller sier han svarte feil uten at noe felt er besvart ennå), sett goto til "source". ' +
            "reply skal ALDRI gjenta eller stille selve feltspørsmålet — det stilles automatisk etterpå. Hold reply til én kort setning, eller tom streng.",
        },
        { role: "user", content: value },
      ]);
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      setStatus(null);
      if (parsed.goto === "source") {
        if (parsed.reply) say("bot", parsed.reply);
        setSourceChosen(false);
        setAnswers({});
        setEditKey(null);
        return;
      }
      const gotoStep = parsed.goto ? DB_FLOW.find((f) => f.key === parsed.goto) : null;
      if (gotoStep) {
        if (parsed.reply) say("bot", parsed.reply);
        // Feltet nullstilles slik at flowen naturlig spør om det igjen.
        setAnswers((prev) => {
          const next = { ...prev };
          delete next[gotoStep.key];
          return next;
        });
        setEditKey(gotoStep.key);
      } else if (step && parsed.accept && parsed.value) {
        if (step.key === "driver" && !Object.keys(DRIVER_MAP).includes(String(parsed.value))) {
          say("bot", "Vi støtter PostgreSQL, MySQL og SQL Server foreløpig.");
        } else {
          acceptAnswer(step, String(parsed.value));
        }
      } else {
        say("bot", parsed.reply || "Det forsto jeg ikke — prøv igjen.");
      }
    } catch {
      setStatus(null);
      say("bot", "Det forsto jeg ikke helt — prøv igjen.");
    }
  }

  function answer(text: string) {
    if (!text.trim()) return;
    const value = text.trim();

    if (!sourceChosen) {
      say("user", value);
      setInput("");
      setHilite(0);
      if (value === "Database") {
        setSourceChosen(true);
        return;
      }
      if (SOURCE_OPTIONS.includes(value)) {
        say("bot", `${value} kommer snart — foreløpig støtter vi Database.`);
        return;
      }
      askAgent(null, value);
      return;
    }

    const step = activeStep;
    say("user", step?.secret ? "••••••••" : value);
    setInput("");
    setHilite(0);
    if (!step) {
      // Alt er besvart: fritekst her er korrigering eller spørsmål — agenten
      // ruter til riktig felt via goto.
      askAgent(null, value);
      return;
    }
    // Menyvalg (eller passord) går rett gjennom skriptet; annen fritekst
    // vurderes av agenten.
    const isSuggestion = step.options(answers).includes(value);
    if (isSuggestion || step.secret) {
      acceptAnswer(step, value);
    } else {
      askAgent(step, value);
    }
  }

  function toggleTable(name: string) {
    setSelTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setInput("");
    setHilite(0);
  }

  function finishTables() {
    say("user", `Valgte bord: ${[...selTables].join(", ")}`);
    setTablesDone(true);
    say("bot", "Notert! Neste steg kommer snart.");
  }

  function pick(option: string) {
    if (tablesPhase) {
      if (option === DONE_ITEM) finishTables();
      else toggleTable(option);
      return;
    }
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
      if (tablesPhase) {
        if (options.length > 0) pick(options[hilite]);
        return;
      }
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
            <div className={styles.canvasQuestion} key={`q-${activeStep?.key ?? "source"}`}>
              <FadeText text={question} />
            </div>
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
      </div>
      <div className={chatStyles.composerDocked}>
        <div className={chatStyles.composerWrap}>
          <div className={chatStyles.composer}>
            <div className={chatStyles.inputRow}>
              <textarea
                className={chatStyles.input}
                rows={1}
                placeholder={status ? "Vent litt …" : "Spør om hva som helst …"}
                value={input}
                disabled={status !== null || busy}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
            </div>
            {options.length > 0 && (
              <div className={styles.comboBody}>
                <div className={styles.comboLabel}>
                  {!sourceChosen ? "Kilder" : tablesPhase ? "Bord" : "Forslag"}
                </div>
                {options.map((o, i) => (
                  <button
                    key={o}
                    type="button"
                    className={`${styles.comboItem} ${i === hilite ? styles.comboItemActive : ""}`}
                    onMouseEnter={() => setHilite(i)}
                    onClick={() => pick(o)}
                  >
                    <span
                      className={`${styles.comboDot} ${
                        (o === DONE_ITEM || selTables.has(o)) && tablesPhase
                          ? styles.comboDotOn
                          : ""
                      }`}
                    />
                    <span className={styles.comboItemLabel}>
                      {o === DONE_ITEM ? `Ferdig (${selTables.size} valgt)` : o}
                    </span>
                    {tablesPhase && o !== DONE_ITEM && (
                      <span className={styles.comboHint}>
                        {schema?.tables.find((t) => t.name === o)?.columns.length} felt
                      </span>
                    )}
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
