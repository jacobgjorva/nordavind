import { useEffect, useState } from "react";
import {
  deleteConnection,
  fetchConnectionSchema,
  type Connection,
  type ConnectionSchema,
} from "../../lib/api";
import styles from "./Connectors.module.css";
import { TableManager } from "./TableManager";
import { swallow } from "../../lib/log";

// Styrt visning: valget skjer i settings-navigasjonen (undersider av Connectors).
export function Connectors({
  conn,
  onReload,
}: {
  conn: Connection | null;
  onReload: () => void;
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


  if (!conn) {
    // Ingen valgt: nye koblinger opprettes ved å be agenten i chatten
    // («koble til Postgres-basen vår») — ingen egen knapp eller veiviser.
    return (
      <div className={styles.connEmpty}>
        Velg en tilkobling over, eller be agenten i chatten om å koble til en ny.
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
