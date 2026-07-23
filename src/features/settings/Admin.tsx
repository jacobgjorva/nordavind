import { useEffect, useState } from "react";
import {
  createAdminUser,
  deleteAdminUser,
  fetchAdminUsers,
  type AdminUser,
} from "../../lib/api";
import styles from "./Admin.module.css";

export function Admin({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    fetchAdminUsers()
      .then(setUsers)
      .catch(() => setError("Kunne ikke hente brukere."));
  }

  useEffect(reload, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createAdminUser(email.trim(), role);
      setEmail("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Noe gikk galt");
    } finally {
      setBusy(false);
    }
  }

  async function remove(user: AdminUser) {
    if (!confirm(`Fjerne ${user.email}?`)) return;
    try {
      await deleteAdminUser(user.id);
      reload();
    } catch {
      setError("Kunne ikke slette brukeren.");
    }
  }

  if (error && !users) return <div>{error}</div>;
  if (!users) return null;

  return (
    <div className={styles.content}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Brukere</div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>E-post</th>
              <th>Rolle</th>
              <th>Forespørsler (30 d)</th>
              <th>Kostnad (30 d)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{u.usage.requests}</td>
                <td>${u.usage.cost_usd.toFixed(4)}</td>
                <td>
                  {u.id !== currentUserId && (
                    <button
                      className={styles.remove}
                      onClick={() => remove(u)}
                    >
                      Fjern
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Inviter bruker</div>
        <form onSubmit={invite} className={styles.inviteForm}>
          <input
            type="email"
            className={styles.input}
            placeholder="navn@bedrift.no"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className={styles.select}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="member">Medlem</option>
            <option value="admin">Admin</option>
          </select>
          <button className={styles.button} disabled={busy}>
            {busy ? "Oppretter …" : "Inviter"}
          </button>
        </form>
        {error && users && <div className={styles.error}>{error}</div>}
      </div>
    </div>
  );
}
