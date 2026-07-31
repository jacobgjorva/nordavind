import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete01Icon } from "@hugeicons/core-free-icons";
import {
  listUnits,
  createUnit,
  updateUnit,
  deleteUnit,
  type OrgUnit,
} from "../../lib/api";
import { swallow } from "../../lib/log";
import styles from "./Employees.module.css";

// Enhetsregisteret (kunnskapsgraf v2): datterselskaper og avdelinger.
// Enhetene er synlighetsgrensene for intern kunnskap — et dokument scopet
// til en enhet er usynlig utenfor den. Samme stil som ansattpanelet.
export function Units() {
  const [list, setList] = useState<OrgUnit[] | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    listUnits().then(setList).catch(() => setList([]));
  }, []);

  async function add() {
    const name = draft.trim();
    if (!name) return;
    try {
      const saved = await createUnit(name);
      setList((l) => [...(l ?? []), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft("");
    } catch {
      // ignorer; brukeren kan prøve igjen
    }
  }

  function rename(id: string, name: string) {
    setList((l) => l?.map((u) => (u.id === id ? { ...u, name } : u)) ?? l);
  }

  function persist(u: OrgUnit) {
    if (!u.name.trim()) return;
    updateUnit(u.id, u.name.trim()).catch(swallow);
  }

  function remove(u: OrgUnit) {
    if (!confirm(`Fjerne enheten ${u.name}? Kunnskap scopet til den blir utilgjengelig til den re-scopes.`)) return;
    setList((l) => l?.filter((x) => x.id !== u.id) ?? l);
    deleteUnit(u.id).catch(swallow);
  }

  if (!list) return null;

  return (
    <div className={styles.content}>
      <div className={styles.intro}>
        Enheter er synlighetsgrenser: kunnskap scopet til en enhet er usynlig
        for resten av virksomheten. Ansatte kobles til enheter i ansattpanelet.
      </div>

      <div className={styles.addRow}>
        <input
          className={styles.input}
          placeholder="Ny enhet (datterselskap eller avdeling)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className={styles.addBtn} onClick={add} disabled={!draft.trim()}>
          Legg til
        </button>
      </div>

      {list.length === 0 ? (
        <div className={styles.empty}>Ingen enheter ennå. Uten enheter er all kunnskap synlig for hele virksomheten.</div>
      ) : (
        <div className={styles.list}>
          {list.map((u) => (
            <div key={u.id} className={styles.row}>
              <input
                className={styles.cell}
                value={u.name}
                onChange={(e) => rename(u.id, e.target.value)}
                onBlur={() => {
                  const cur = list.find((x) => x.id === u.id);
                  if (cur) persist(cur);
                }}
              />
              <button className={styles.del} onClick={() => remove(u)} aria-label="Fjern">
                <HugeiconsIcon icon={Delete01Icon} size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
