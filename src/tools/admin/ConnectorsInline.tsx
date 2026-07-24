import { useEffect, useState } from "react";
import {
  fetchConnections,
  fetchM365Status,
  type Connection,
} from "../../lib/api";
import { Connectors } from "../../features/settings/Connectors";
import { M365Panel } from "../../features/settings/M365Panel";
import { emit, on } from "../../lib/events";
import { swallow } from "../../lib/log";
import styles from "./AdminPanel.module.css";

// Lesbare navn per databasetype i velgeren.
const DRIVER_LABELS: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mssql: "SQL Server",
};

// Frittstående tilkoblingspanel for chatten: velgeren som lå i settings-
// navigasjonen er her en horisontal rad over selve panelet.
export function ConnectorsInline() {
  const [conns, setConns] = useState<Connection[]>([]);
  const [connId, setConnId] = useState<string | null>(null);
  const [m365Connected, setM365Connected] = useState(false);
  const [showM365, setShowM365] = useState(false);

  function reload() {
    fetchConnections()
      .then((list) => {
        setConns(list);
        // Vis eksisterende tilkoblinger med en gang — velg den første.
        setConnId((cur) => cur ?? list[0]?.id ?? null);
      })
      .catch(swallow);
    fetchM365Status()
      .then((s) => setM365Connected(s.connected))
      .catch(swallow);
  }
  useEffect(reload, []);
  // Ny kobling opprettes i hovedchatten — last lista når agenten er ferdig.
  useEffect(() => on("connections-changed", reload), []);

  const active = conns.find((c) => c.id === connId) ?? null;

  return (
    <div className={styles.panelCard}>
      <div className={styles.topRow}>
      {/* Dropdown skalerer til titalls koblinger uten å ta plass. */}
      <select
        className={styles.connSelect}
        value={showM365 ? "__m365" : connId ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__m365") {
            setShowM365(true);
            setConnId(null);
          } else {
            setShowM365(false);
            setConnId(v);
          }
        }}
      >
        {m365Connected && <option value="__m365">Microsoft 365</option>}
        {conns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} — {DRIVER_LABELS[c.driver] ?? c.driver}
          </option>
        ))}
      </select>
        <button
          className={styles.createBtn}
          onClick={() =>
            emit("compose-send", { text: "Opprett en ny kobling", reply: "Hva skal vi koble til?", intent: "connect" })
          }
          title="Be agenten opprette en ny kobling"
        >
          Opprett kobling
        </button>
      </div>
      {showM365 ? (
        <M365Panel
          onChanged={() => {
            setShowM365(false);
            reload();
          }}
        />
      ) : (
        <Connectors conn={active} onReload={reload} />
      )}
    </div>
  );
}
