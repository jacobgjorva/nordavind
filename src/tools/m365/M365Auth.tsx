import { useEffect, useRef, useState } from "react";
import { connectM365, fetchM365Status } from "../../lib/api";
import { emit } from "../../lib/events";
import styles from "./M365.module.css";

// M365Auth er innloggings-steget i chatten: én knapp som åpner Microsofts
// OAuth-vindu og poller status til koblingen er bekreftet.
export function M365Auth() {
  const [state, setState] = useState<"idle" | "waiting" | "done">("idle");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const pollRef = useRef<number>(0);

  useEffect(() => {
    fetchM365Status()
      .then((s) => {
        if (s.connected) {
          setEmail(s.email ?? "");
          setState("done");
        }
      })
      .catch(() => undefined);
    return () => window.clearInterval(pollRef.current);
  }, []);

  async function start() {
    setError("");
    setState("waiting");
    try {
      const { url } = await connectM365();
      window.open(url, "_blank", "width=520,height=680");
      pollRef.current = window.setInterval(async () => {
        const st = await fetchM365Status().catch(() => null);
        if (st?.connected) {
          window.clearInterval(pollRef.current);
          setEmail(st.email ?? "");
          setState("done");
          emit("connections-changed");
        }
      }, 2000);
      window.setTimeout(() => window.clearInterval(pollRef.current), 180000);
    } catch {
      setError("Kunne ikke starte Microsoft-innloggingen. Prøv igjen.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <div className={styles.card}>
        <div className={styles.doneRow}>
          <span className={styles.doneMark}>✓</span>
          <span className={styles.doneText}>
            Microsoft 365 er koblet til{email ? ` som ${email}` : ""}.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      {error && <div className={styles.error}>{error}</div>}
      <button className={styles.primary} disabled={state === "waiting"} onClick={start}>
        {state === "waiting" ? "Venter på innloggingen …" : "Logg inn med Microsoft"}
      </button>
      <div className={styles.hint}>Innloggingen skjer i et eget Microsoft-vindu.</div>
    </div>
  );
}
