import { useState } from "react";
import { Logo } from "../../ui/Logo";
import { requestCode, verifyCode, setToken, type AuthUser } from "../../lib/api";
import styles from "./Login.module.css";

export function Login({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestCode(email.trim());
      setStep("code");
    } catch {
      setError("Kunne ikke sende kode. Prøv igjen.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await verifyCode(email.trim(), code.trim());
      setToken(res.token);
      onLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Noe gikk galt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <Logo size={22} />
          <span>Nordavind</span>
        </div>

        {step === "email" ? (
          <form onSubmit={submitEmail} className={styles.form}>
            <label className={styles.label} htmlFor="email">
              Logg inn med jobb-e-posten din
            </label>
            <input
              id="email"
              type="email"
              className={styles.input}
              placeholder="navn@bedrift.no"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <button className={styles.button} disabled={busy}>
              {busy ? "Sender …" : "Send kode"}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode} className={styles.form}>
            <label className={styles.label} htmlFor="code">
              Skriv inn koden sendt til {email}
            </label>
            <input
              id="code"
              inputMode="numeric"
              maxLength={6}
              className={`${styles.input} ${styles.codeInput}`}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
            <button className={styles.button} disabled={busy}>
              {busy ? "Verifiserer …" : "Logg inn"}
            </button>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            >
              Bruk en annen e-post
            </button>
          </form>
        )}

        {error && <div className={styles.error}>{error}</div>}
      </div>
    </div>
  );
}
