import { useEffect, useState } from "react";
import {
  disconnectM365,
  fetchM365Status,
  type M365Status,
} from "../../lib/api";
import { swallow } from "../../lib/log";
import styles from "./Connectors.module.css";

// Administrasjon av en eksisterende Microsoft 365-kobling (status + frakobling).
// Selve tilkoblingen opprettes via connector-agenten («+ Ny kobling»).
export function M365Panel({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<M365Status | null>(null);

  useEffect(() => {
    fetchM365Status().then(setStatus).catch(swallow);
  }, []);

  async function disconnect() {
    if (!confirm("Koble fra Microsoft 365? Live OneDrive-eksporter slutter å oppdatere.")) return;
    await disconnectM365().catch(swallow);
    onChanged();
  }

  if (!status) return <div className={styles.empty}>Henter …</div>;

  return (
    <div className={styles.m365}>
      <div className={styles.m365Head}>Microsoft 365</div>
      <p className={styles.m365Desc}>
        Live Excel-eksport til OneDrive og SharePoint. Utvides senere med mail
        og Teams — samme samtykke.
      </p>
      {status.connected ? (
        <div className={styles.m365Row}>
          <span className={styles.m365Ok}>Koblet til som {status.email}</span>
          <button className={styles.danger} onClick={disconnect}>
            Koble fra
          </button>
        </div>
      ) : (
        <p className={styles.m365Note}>
          Ikke koblet til. Bruk «+ Ny kobling» og be agenten koble til
          Microsoft 365.
        </p>
      )}
    </div>
  );
}
