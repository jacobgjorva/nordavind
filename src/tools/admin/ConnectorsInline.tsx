import { useEffect, useState } from "react";
import {
  fetchConnections,
  fetchM365Status,
  type Connection,
} from "../../lib/api";
import { Connectors } from "../../features/settings/Connectors";
import { M365Panel } from "../../features/settings/M365Panel";
import { swallow } from "../../lib/log";
import styles from "./AdminPanel.module.css";

// Frittstående tilkoblingspanel for chatten: velgeren som lå i settings-
// navigasjonen er her en horisontal rad over selve panelet.
export function ConnectorsInline() {
  const [conns, setConns] = useState<Connection[]>([]);
  const [connId, setConnId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [m365Connected, setM365Connected] = useState(false);
  const [showM365, setShowM365] = useState(false);

  function reload() {
    fetchConnections().then(setConns).catch(swallow);
    fetchM365Status()
      .then((s) => setM365Connected(s.connected))
      .catch(swallow);
  }
  useEffect(reload, []);

  const active = conns.find((c) => c.id === connId) ?? null;

  return (
    <div className={styles.panelCard}>
      <div className={styles.connRow}>
        {m365Connected && (
          <button
            className={`${styles.connTab} ${showM365 ? styles.connTabActive : ""}`}
            onClick={() => {
              setShowM365(true);
              setCreating(false);
              setConnId(null);
            }}
          >
            Microsoft 365
          </button>
        )}
        {conns.map((c) => (
          <button
            key={c.id}
            className={`${styles.connTab} ${
              !creating && !showM365 && connId === c.id ? styles.connTabActive : ""
            }`}
            onClick={() => {
              setShowM365(false);
              setCreating(false);
              setConnId(c.id);
            }}
          >
            {c.name}
          </button>
        ))}
        <button
          className={`${styles.connTab} ${creating ? styles.connTabActive : ""}`}
          onClick={() => {
            setShowM365(false);
            setCreating(true);
          }}
        >
          + Ny kobling
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
        <Connectors
          conn={active}
          creating={creating}
          onReload={reload}
          onNew={() => setCreating(true)}
        />
      )}
    </div>
  );
}
