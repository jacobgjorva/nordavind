import { useEffect, useState } from "react";
import {
  deleteConnection,
  fetchConnectionSchema,
  type Connection,
  type ConnectionSchema,
} from "../../lib/api";
import styles from "./Connectors.module.css";
import { ChatWizard } from "./ChatWizard";
import { TableManager } from "./TableManager";
import { swallow } from "../../lib/log";

// Styrt visning: valget skjer i settings-navigasjonen (undersider av Connectors).
export function Connectors({
  conn,
  creating,
  onReload,
  onNew,
  onDoneCreate,
}: {
  conn: Connection | null;
  creating: boolean;
  onReload: () => void;
  onNew: () => void;
  onDoneCreate: () => void;
}) {
  const [schema, setSchema] = useState<ConnectionSchema | null>(null);

  useEffect(() => {
    setSchema(null);
    if (conn) {
      fetchConnectionSchema(conn.id).then(setSchema).catch(swallow);
    }
  }, [conn?.id]);

  async function remove() {
    if (!conn || !confirm(`Fjerne tilkoblingen ${conn.name}?`)) return;
    await deleteConnection(conn.id).catch(swallow);
    onReload();
  }

  if (creating) {
    return (
      <ChatWizard
        initialConn={null}
        onClose={() => {
          onDoneCreate();
          onReload();
        }}
      />
    );
  }

  if (!conn) {
    return (
      <div className={styles.connEmpty}>
        <button className={styles.primary} onClick={onNew}>
          Ny kobling
        </button>
      </div>
    );
  }

  if (!schema) return <div className={styles.empty}>Henter …</div>;

  return (
    <TableManager
      key={conn.id}
      conn={conn}
      schema={schema}
      onClose={onReload}
      onRemove={remove}
    />
  );
}
