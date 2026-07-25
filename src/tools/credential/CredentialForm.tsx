import { useState } from "react";
import { createConnection } from "../../lib/api";
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

export function CredentialForm({ spec }: { spec: CredentialSpec }) {
  const [name, setName] = useState(spec.name ?? "");
  const [driver, setDriver] = useState(spec.driver ?? "postgres");
  const [host, setHost] = useState(spec.host ?? "");
  const [port, setPort] = useState<string>(spec.port ? String(spec.port) : "");
  const [database, setDatabase] = useState(spec.database ?? "");
  const [user, setUser] = useState(spec.user ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [doneName, setDoneName] = useState("");

  if (doneName) {
    return (
      <div className={styles.card}>
        <div className={styles.done}>
          Tilkoblingen «{doneName}» er opprettet og testet ✓ — si fra i chatten
          når du vil velge tabeller.
        </div>
      </div>
    );
  }

  const ready =
    name.trim() && host.trim() && database.trim() && user.trim() && password;

  async function submit() {
    setBusy(true);
    setError("");
    const pw = password;
    setPassword(""); // aldri la hemmeligheten bli liggende i feltet
    try {
      await createConnection({
        name: name.trim(),
        driver,
        host: host.trim(),
        port: Number(port) || defaultPorts[driver] || 0,
        database: database.trim(),
        user: user.trim(),
        password: pw,
      });
      setDoneName(name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tilkoblingen feilet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.title}>Koble til database</div>
      <div className={styles.row}>
        <span className={styles.label}>Navn</span>
        <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="f.eks. Kundedata" />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Type</span>
        <select className={styles.select} value={driver} onChange={(e) => setDriver(e.target.value)}>
          <option value="postgres">PostgreSQL</option>
          <option value="mysql">MySQL</option>
          <option value="mssql">SQL Server</option>
        </select>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Host</span>
        <input className={styles.input} value={host} onChange={(e) => setHost(e.target.value)} />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Port</span>
        <input
          className={styles.input}
          value={port}
          onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
          placeholder={String(defaultPorts[driver] ?? "")}
          inputMode="numeric"
        />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Database</span>
        <input className={styles.input} value={database} onChange={(e) => setDatabase(e.target.value)} />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Bruker</span>
        <input className={styles.input} value={user} onChange={(e) => setUser(e.target.value)} />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Passord</span>
        <input
          className={styles.input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.footer}>
        <span className={styles.hint}>Sendes kryptert direkte — vises aldri i chatten.</span>
        <button className={styles.submit} disabled={!ready || busy} onClick={submit}>
          {busy ? "Tester …" : "Koble til"}
        </button>
      </div>
    </div>
  );
}
