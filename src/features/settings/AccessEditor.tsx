import { useState } from "react";
import { SearchIcon } from "../../ui/Icons";
import type { AdminUser } from "../../lib/api";
import styles from "./Connectors.module.css";

// Tilgang per bord: full brukertabell med søk, avkrysning og «alle»-modus.
export function AccessEditor({
  users,
  userIds,
  onChange,
}: {
  users: AdminUser[];
  userIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const searching = q !== "";
  // Tomt søk: vis de som har tilgang. Søk: vis treff (for å legge til/fjerne).
  const rows = searching
    ? users.filter((u) => u.email.toLowerCase().includes(q))
    : users.filter((u) => userIds.includes(u.id));

  function toggle(id: string) {
    onChange(
      userIds.includes(id) ? userIds.filter((x) => x !== id) : [...userIds, id]
    );
  }

  return (
    <div className={styles.acc}>
      <div className={styles.accSearchWrap}>
        <SearchIcon size={14} className={styles.accSearchIcon} />
        <input
          className={styles.accSearch}
          placeholder="Søk og legg til bruker …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className={styles.accCount}>{userIds.length} med tilgang</span>
      </div>

      <div className={styles.accBody}>
        {rows.length === 0 && (
          <div className={styles.accEmpty}>
            {searching ? "Ingen treff." : "Ingen brukere har tilgang ennå."}
          </div>
        )}
        {rows.map((u) => (
          <label key={u.id} className={styles.accRow}>
            <input
              type="checkbox"
              checked={userIds.includes(u.id)}
              onChange={() => toggle(u.id)}
            />
            <span className={styles.accEmail}>{u.email}</span>
            <span className={styles.accRole}>{u.role}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
