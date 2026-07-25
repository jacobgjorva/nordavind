import { useContext, useState } from "react";
import { TableQueryContext } from "../../features/chat/blocks/core";
import { exportTableXLSX, exportToOneDrive } from "../../lib/api";
import styles from "./ExportCard.module.css";

// ExportCard: eksportvalget levert rett i chatten når brukeren ba om eksport —
// aldri «vil du at jeg skal eksportere?». Data kommer fra blokka, spørringen
// (for live OneDrive) fra meldingens query-kontekst.
export function ExportCard({ title, columns, rows }: { title: string; columns: string[]; rows: string[][] }) {
  const query = useContext(TableQueryContext);
  const [busy, setBusy] = useState<"onedrive" | "local" | null>(null);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  async function local() {
    if (busy) return;
    setBusy("local");
    setError("");
    try {
      await exportTableXLSX(title, columns, rows);
      setDone("Excel-fila er lastet ned.");
    } catch {
      setError("Eksporten feilet — prøv igjen.");
    } finally {
      setBusy(null);
    }
  }

  async function onedrive() {
    if (busy || !query) return;
    setBusy("onedrive");
    setError("");
    try {
      const r = await exportToOneDrive(title, query);
      if (r.url) window.open(r.url, "_blank");
      setDone("Live-arbeidsboka ligger i OneDrive.");
    } catch {
      setError("Kunne ikke opprette OneDrive-arbeidsboka — er Microsoft 365 koblet til?");
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <div className={styles.card}>
        <span className={styles.doneMark}>✓</span> {done}
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.title}>{title || "Eksport"} — {rows.length} rader klare</div>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.actions}>
        <button className={styles.btn} disabled={busy !== null} onClick={local}>
          {busy === "local" ? "Lager fila …" : "Last ned Excel"}
        </button>
        {query && (
          <button className={styles.btn} disabled={busy !== null} onClick={onedrive}>
            {busy === "onedrive" ? "Oppretter …" : "Live i OneDrive"}
          </button>
        )}
      </div>
    </div>
  );
}
