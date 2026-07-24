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

// Frittstående tilkoblingspanel for chatten: velgeren som lå i settings-
// navigasjonen er her en horisontal rad over selve panelet.
export function ConnectorsInline() {
  const [conns, setConns] = useState<Connection[]>([]);
  const [connId, setConnId] = useState<string | null>(null);
  const [m365Connected, setM365Connected] = useState(false);
  const [showM365, setShowM365] = useState(false);

  function reload() {
    fetchConnections().then(setConns).catch(swallow);
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
      <div className={styles.connRow}>
        {m365Connected && (
          <button
            className={`${styles.connTab} ${showM365 ? styles.connTabActive : ""}`}
            onClick={() => {
              setShowM365(true);
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
              !showM365 && connId === c.id ? styles.connTabActive : ""
            }`}
            onClick={() => {
              setShowM365(false);
              setConnId(c.id);
            }}
          >
            {c.name}
          </button>
        ))}
        {/* Oppretting skjer i hovedchatten — ingen chat-i-chat. */}
        <button className={styles.connTab} onClick={() => emit("connector-mode")}>
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
          creating={false}
          onReload={reload}
          onNew={() => emit("connector-mode")}
        />
      )}
    </div>
  );
}
