import { useState } from "react";
import { createPortal } from "react-dom";
import {
  exportTableXLSX,
  exportToOneDrive,
  type TableQuery,
} from "../../lib/api";
import styles from "./ExportModal.module.css";

// Eksport-modal: to tydelige valg. OneDrive = vi pusher ferske tall inn i en
// arbeidsbok i skyen (live). Lokal Excel = ren .xlsx uten kobling.
export function ExportModal({
  title,
  columns,
  rows,
  query,
  onClose,
}: {
  title: string;
  columns: string[];
  rows: string[][];
  query: TableQuery | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"onedrive" | "local" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickLocal() {
    if (busy) return;
    setBusy("local");
    setError(null);
    try {
      await exportTableXLSX(title, columns, rows);
      onClose();
    } catch {
      setError("Eksporten feilet — prøv igjen.");
      setBusy(null);
    }
  }

  async function pickOneDrive() {
    if (busy || !query) return;
    setBusy("onedrive");
    setError(null);
    try {
      const r = await exportToOneDrive(title, query);
      if (r.url) window.open(r.url, "_blank");
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(
        msg.includes("412")
          ? "Koble til Microsoft 365 først (Settings → Connectors → Ny kobling)."
          : msg.includes("501")
            ? "OneDrive-koblingen er ikke satt opp for arbeidsområdet ennå."
            : "Kunne ikke opprette OneDrive-arbeidsboka."
      );
      setBusy(null);
    }
  }

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.heading}>Eksporter tabellen</div>
        <div className={styles.cards}>
          <button
            className={`${styles.card} ${!query ? styles.cardDisabled : ""}`}
            onClick={pickOneDrive}
            disabled={!query || busy !== null}
          >
            <span className={styles.cardTitle}>OneDrive</span>
            <span className={styles.cardBadge}>Live data</span>
            <span className={styles.cardDesc}>
              Arbeidsbok i skyen som alltid har ferske tall. Åpnes i Excel der
              du er.
            </span>
            {busy === "onedrive" && (
              <span className={styles.cardBusy}>Oppretter …</span>
            )}
            {!query && (
              <span className={styles.cardNote}>
                Krever at tabellen er koblet til databasen
              </span>
            )}
          </button>
          <button
            className={styles.card}
            onClick={pickLocal}
            disabled={busy !== null}
          >
            <span className={styles.cardTitle}>Excel lokalt</span>
            <span className={styles.cardBadge}>Uten kobling</span>
            <span className={styles.cardDesc}>
              Ren .xlsx lastes ned nå — et øyeblikksbilde av tabellen slik den
              står.
            </span>
            {busy === "local" && (
              <span className={styles.cardBusy}>Eksporterer …</span>
            )}
          </button>
        </div>
        {error && <div className={styles.error}>{error}</div>}
      </div>
    </div>,
    document.body
  );
}
