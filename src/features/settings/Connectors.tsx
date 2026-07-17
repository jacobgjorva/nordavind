import { useEffect, useState } from "react";
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
function ChatWizard({
  onClose,
}: {
  initialConn: Connection | null;
  onClose: () => void;
}) {
  return (
    <div className={styles.canvas}>
      <div className={styles.canvasScroll} />
      <div className={styles.canvasInputRow}>
        <button type="button" className={styles.cancel} onClick={onClose}>
          Avbryt
        </button>
      </div>
    </div>
  );
}
