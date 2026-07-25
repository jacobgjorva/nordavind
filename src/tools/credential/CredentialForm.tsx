import { useState } from "react";
import { createConnection, testConnection, type Connection } from "../../lib/api";
import { Connectors } from "../../features/settings/Connectors";
import { emit } from "../../lib/events";
import styles from "./Credential.module.css";

// CredentialForm er chattens sikre inntaksfelt for databasetilkoblinger:
// passordet POST-es direkte til /connections og finnes aldri i noen
// chatmelding, logg eller LLM-kontekst. Feltet tømmes ved innsending.

export interface CredentialSpec {
  name?: string;
  driver?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
}

const defaultPorts: Record<string, number> = {
  postgres: 5432,
  mysql: 3306,
  mssql: 1433,
};

const knownDefaults = new Set(Object.values(defaultPorts).map(String));

export function CredentialForm({ spec }: { spec: CredentialSpec }) {
  const initialDriver = spec.driver ?? "postgres";
  const [name, setName] = useState(spec.name ?? "");
  const [driver, setDriver] = useState(initialDriver);
  const [host, setHost] = useState(spec.host ?? "");
  // Port forhåndsutfylles med databasetypens standard og følger typevalget
  // så lenge brukeren ikke har satt en egen verdi.
  const [port, setPort] = useState<string>(
    spec.port ? String(spec.port) : String(defaultPorts[initialDriver] ?? "")
  );
  const [database, setDatabase] = useState(spec.database ?? "");
  const [user, setUser] = useState(spec.user ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"" | "test" | "save">("");
  const [error, setError] = useState("");
  const [testOK, setTestOK] = useState(false);
  const [created, setCreated] = useState<Connection | null>(null);


  // Rett i tabellvalget: brukeren styrer tilganger med en gang, ingen
  // mellommelding.
  if (created) {
    return (
      <div className={styles.card}>
        <Connectors conn={created} onReload={() => emit("connections-changed")} />
      </div>
    );
  }

  function changeDriver(next: string) {
    setDriver(next);
    if (!port || knownDefaults.has(port)) {
      setPort(String(defaultPorts[next] ?? ""));
    }
  }

  const filled =
    host.trim() && database.trim() && user.trim() && password;
  const ready = name.trim() && filled;

  function payload(pw: string) {
    return {
      driver,
      host: host.trim(),
      port: Number(port) || defaultPorts[driver] || 0,
      database: database.trim(),
      user: user.trim(),
      password: pw,
    };
  }

  async function runTest() {
    setBusy("test");
    setError("");
    setTestOK(false);
    try {
      await testConnection(payload(password));
      setTestOK(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tilkoblingen feilet.");
    } finally {
      setBusy("");
    }
  }

  async function submit() {
    setBusy("save");
    setError("");
    const pw = password;
    setPassword(""); // aldri la hemmeligheten bli liggende i feltet
    try {
      const conn = await createConnection({ name: name.trim(), ...payload(pw) });
      emit("connections-changed");
      setCreated(conn);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tilkoblingen feilet.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span className={styles.label}>Navn</span>
          <input
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Visningsnavn, f.eks. Kundedata"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Type</span>
          <select className={styles.select} value={driver} onChange={(e) => changeDriver(e.target.value)}>
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL</option>
            <option value="mssql">SQL Server</option>
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Host</span>
          <input
            className={styles.input}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="Serveradresse, f.eks. db.example.com"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Port</span>
          <input
            className={styles.input}
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
            placeholder={`Standard for ${driver === "mssql" ? "SQL Server" : driver === "mysql" ? "MySQL" : "PostgreSQL"}: ${defaultPorts[driver]}`}
            inputMode="numeric"
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Database</span>
          <input
            className={styles.input}
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            placeholder="Navnet på selve databasen"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Bruker</span>
          <input
            className={styles.input}
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="Databasebruker med lesetilgang"
          />
        </label>

        <label className={`${styles.field} ${styles.span2}`}>
          <span className={styles.label}>Passord</span>
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ready && !busy) submit();
            }}
            autoComplete="new-password"
            placeholder="Sendes kryptert, vises aldri i chatten"
          />
        </label>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {testOK && !error && (
        <div className={styles.testOk}>
          <span className={styles.testOkMark}>✓</span> Tilkoblingen svarer
        </div>
      )}

      <div className={styles.actions}>
        <button
          className={styles.testBtn}
          disabled={!filled || busy !== ""}
          onClick={runTest}
        >
          {busy === "test" ? "Tester …" : "Test tilkobling"}
        </button>
        <button className={styles.submit} disabled={!ready || busy !== ""} onClick={submit}>
          {busy === "save" ? "Kobler til …" : "Koble til"}
        </button>
      </div>
    </div>
  );
}
