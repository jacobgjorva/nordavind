import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete01Icon } from "@hugeicons/core-free-icons";
import {
  listEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  listUnits,
  type Employee,
  type EmployeeInput,
  type OrgUnit,
} from "../../lib/api";
import { swallow } from "../../lib/log";
import styles from "./Employees.module.css";

const EMPTY: EmployeeInput = { name: "", role: "", description: "", email: "", unit_id: "" };

// Ansatt-register: hvem gjør hva, med e-post. AI-en bruker det til å foreslå å
// kontakte rett person når den selv ikke kommer videre.
export function Employees() {
  const [list, setList] = useState<Employee[] | null>(null);
  const [draft, setDraft] = useState<EmployeeInput>(EMPTY);
  const [units, setUnits] = useState<OrgUnit[]>([]);

  useEffect(() => {
    listEmployees().then(setList).catch(() => setList([]));
    listUnits().then(setUnits).catch(swallow);
  }, []);

  async function add() {
    if (!draft.name.trim()) return;
    try {
      const saved = await createEmployee(draft);
      setList((l) => [...(l ?? []), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft(EMPTY);
    } catch {
      // ignorer; brukeren kan prøve igjen
    }
  }

  function toggleUnit(id: string, unitID: string) {
    setList((l) => {
      const next = l?.map((e) => {
        if (e.id !== id) return e;
        const has = (e.unit_ids ?? []).includes(unitID);
        const unit_ids = has
          ? (e.unit_ids ?? []).filter((x) => x !== unitID)
          : [...(e.unit_ids ?? []), unitID];
        return { ...e, unit_ids };
      }) ?? l;
      const cur = next?.find((e) => e.id === id);
      if (cur) persist(cur);
      return next;
    });
  }

  function patch(id: string, field: keyof EmployeeInput, value: string) {
    setList((l) => l?.map((e) => (e.id === id ? { ...e, [field]: value } : e)) ?? l);
  }

  function persist(e: Employee) {
    updateEmployee(e.id, {
      name: e.name,
      role: e.role,
      description: e.description,
      email: e.email,
      unit_ids: e.unit_ids ?? [],
    }).catch(swallow);
  }

  function remove(id: string, name: string) {
    if (!confirm(`Fjerne ${name} fra registeret?`)) return;
    setList((l) => l?.filter((e) => e.id !== id) ?? l);
    deleteEmployee(id).catch(swallow);
  }

  if (!list) return null;

  return (
    <div className={styles.content}>
      <div className={styles.intro}>
        Hvem gjør hva. AI-en foreslår å kontakte rett person når den ikke kommer videre selv.
      </div>

      <div className={styles.addRow}>
        <input
          className={styles.input}
          placeholder="Navn"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <input
          className={styles.input}
          placeholder="Rolle"
          value={draft.role}
          onChange={(e) => setDraft({ ...draft, role: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <input
          className={styles.input}
          placeholder="Funksjon / ansvar"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <input
          className={styles.input}
          placeholder="E-post"
          value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className={styles.addBtn} onClick={add} disabled={!draft.name.trim()}>
          Legg til
        </button>
      </div>

      {list.length === 0 ? (
        <div className={styles.empty}>Ingen ansatte i registeret ennå.</div>
      ) : (
        <div className={styles.list}>
          {list.map((e) => (
            <div key={e.id} className={styles.row}>
              <input
                className={styles.cell}
                value={e.name}
                onChange={(ev) => patch(e.id, "name", ev.target.value)}
                onBlur={() => persist(e)}
              />
              <input
                className={styles.cell}
                value={e.role}
                onChange={(ev) => patch(e.id, "role", ev.target.value)}
                onBlur={() => persist(e)}
              />
              <input
                className={styles.cell}
                value={e.description}
                onChange={(ev) => patch(e.id, "description", ev.target.value)}
                onBlur={() => persist(e)}
              />
              <input
                className={styles.cell}
                value={e.email}
                onChange={(ev) => patch(e.id, "email", ev.target.value)}
                onBlur={() => persist(e)}
              />
              {units.length > 0 && (
                <div className={styles.unitChips}>
                  {units.map((u) => {
                    const active = (e.unit_ids ?? []).includes(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        className={active ? styles.unitChipOn : styles.unitChip}
                        onClick={() => toggleUnit(e.id, u.id)}
                        title={active ? `Fjern fra ${u.name}` : `Legg til i ${u.name}`}
                      >
                        {u.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                className={styles.del}
                onClick={() => remove(e.id, e.name)}
                aria-label="Fjern"
              >
                <HugeiconsIcon icon={Delete01Icon} size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
