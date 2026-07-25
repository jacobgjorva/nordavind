import { useState } from "react";
import { saveM365App } from "../../lib/api";
import { M365Auth } from "./M365Auth";
import styles from "./M365.module.css";

// M365AppForm samler Azure app-registreringen sikkert: secret-en POST-es
// direkte til API-et og finnes aldri i chatmeldinger eller LLM-kontekst.
export function M365AppForm() {
  const [clientId, setClientId] = useState("");
  const [directoryId, setDirectoryId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  if (saved) return <M365Auth />;

  const ready = clientId.trim() && directoryId.trim() && secret;

  async function submit() {
    setBusy(true);
    setError("");
    const sec = secret;
    setSecret(""); // aldri la hemmeligheten bli liggende i feltet
    try {
      await saveM365App({
        client_id: clientId.trim(),
        client_secret: sec,
        directory_id: directoryId.trim(),
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunne ikke lagre app-registreringen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span className={styles.label}>Application (client) ID</span>
          <input
            className={styles.input}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Fra oversiktssiden i Azure"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Directory (tenant) ID</span>
          <input
            className={styles.input}
            value={directoryId}
            onChange={(e) => setDirectoryId(e.target.value)}
            placeholder="Samme side i Azure"
          />
        </label>
        <label className={`${styles.field} ${styles.span2}`}>
          <span className={styles.label}>Client secret</span>
          <input
            className={styles.input}
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="new-password"
            placeholder="Verdien fra Certificates & secrets — sendes kryptert"
          />
        </label>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      <button className={styles.primary} disabled={!ready || busy} onClick={submit}>
        {busy ? "Lagrer …" : "Lagre og start innloggingen"}
      </button>
    </div>
  );
}
