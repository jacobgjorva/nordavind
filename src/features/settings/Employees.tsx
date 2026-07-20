import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete01Icon } from "@hugeicons/core-free-icons";
import {
  listEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  type Employee,
  type EmployeeInput,
} from "../../lib/api";
import { swallow } from "../../lib/log";
import styles from "./Employees.module.css";

const EMPTY: EmployeeInput = { name: "", role: "", description: "", email: "" };

// Ansatt-register: hvem gjør hva, med e-post. AI-en bruker det til å foreslå å
// kontakte rett person når den selv ikke kommer videre.
export function Employees() {
  const [list, setList] = useState<Employee[] | null>(null);
  const [draft, setDraft] = useState<EmployeeInput>(EMPTY);

  useEffect(() => {
    listEmployees().then(setList).catch(() => setList([]));
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

  function patch(id: string, field: keyof EmployeeInput, value: string) {
    setList((l) => l?.map((e) => (e.id === id ? { ...e, [field]: value } : e)) ?? l);
  }

  function persist(e: Employee) {
    updateEmployee(e.id, {
      name: e.name,
      role: e.role,
      description: e.description,
      email: e.email,
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
