import { useEffect, useRef, useState } from "react";
import { connectM365, fetchM365Status } from "../../lib/api";
import { swallow } from "../../lib/log";
import styles from "./M365Onboarding.module.css";

// Førstegangs-steg etter innlogging: er tenantens Microsoft 365-app satt opp
// og brukeren ikke koblet til, tilbys innloggingen med en gang. Vises til
// brukeren enten kobler til eller hopper over (huskes per bruker).

const dismissKey = (userId: string) => `m365-onboarding-dismissed:${userId}`;

export function M365Onboarding({ userId }: { userId: string }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<number>(0);

  useEffect(() => {
    if (localStorage.getItem(dismissKey(userId))) return;
    fetchM365Status()
      .then((s) => setShow(s.configured && !s.connected))
      .catch(swallow);
    return () => window.clearInterval(pollRef.current);
  }, [userId]);

  if (!show) return null;

  function dismiss() {
    localStorage.setItem(dismissKey(userId), "1");
    window.clearInterval(pollRef.current);
    setShow(false);
  }

  async function start() {
    setBusy(true);
    setError("");
    try {
      const { url } = await connectM365();
      window.open(url, "_blank", "width=520,height=680");
      pollRef.current = window.setInterval(async () => {
        const st = await fetchM365Status().catch(() => null);
        if (st?.connected) {
          localStorage.setItem(dismissKey(userId), "1");
          window.clearInterval(pollRef.current);
          setShow(false);
        }
      }, 2000);
    } catch {
      setError("Kunne ikke starte Microsoft-innloggingen. Prøv igjen, eller hopp over.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.title}>Koble til Microsoft 365</div>
        <div className={styles.sub}>
          Bedriften din bruker Microsoft 365 her. Logg inn med din egen
          Microsoft-konto, så får du OneDrive, SharePoint og live
          Excel-eksport rett i chatten.
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.actions}>
          <button className={styles.skip} onClick={dismiss}>
            Hopp over
          </button>
          <button className={styles.connect} disabled={busy} onClick={start}>
            {busy ? "Venter på innloggingen …" : "Logg inn med Microsoft"}
          </button>
        </div>
      </div>
    </div>
  );
}
