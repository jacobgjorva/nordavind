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
        <div className={styles.doneRow}>
          <span className={styles.doneMark}>✓</span>
          <div>
            <div className={styles.doneText}>Tilkoblingen «{doneName}» er opprettet og testet.</div>
            <div className={styles.doneSub}>Si fra i chatten når du vil velge hvilke tabeller AI-en skal se.</div>
          </div>
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
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <span className={styles.title}>Databasetilkobling</span>
          <span className={styles.dot}>·</span>
          <span className={styles.meta}>kryptert</span>
        </div>
        <div className={styles.sub}>
          Fyll inn detaljene, så testes og lagres tilkoblingen automatisk.
          Passordet sendes direkte og vises aldri i chatten.
        </div>
      </div>

      <div className={styles.grid}>
        <label className={styles.field}>
          <input
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Navn, f.eks. Kundedata"
          />
        </label>
        <label className={styles.field}>
          <select className={styles.select} value={driver} onChange={(e) => setDriver(e.target.value)}>
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL</option>
            <option value="mssql">SQL Server</option>
          </select>
        </label>

        <label className={styles.field}>
          <input
            className={styles.input}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="Host, f.eks. db.example.com"
          />
        </label>
        <label className={styles.field}>
          <input
            className={styles.input}
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
            placeholder={`Port, standard ${defaultPorts[driver] ?? ""}`}
            inputMode="numeric"
          />
        </label>

        <label className={styles.field}>
          <input className={styles.input} value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="Database" />
        </label>
        <label className={styles.field}>
          <input className={styles.input} value={user} onChange={(e) => setUser(e.target.value)} placeholder="Bruker" />
        </label>

        <label className={`${styles.field} ${styles.span2}`}>
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ready && !busy) submit();
            }}
            autoComplete="new-password"
            placeholder="Passord"
          />
        </label>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <button className={styles.submit} disabled={!ready || busy} onClick={submit}>
        {busy ? "Tester tilkoblingen …" : "Koble til"}
      </button>
    </div>
  );
}
