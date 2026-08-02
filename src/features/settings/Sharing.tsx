import { useEffect, useState } from "react";
import {
  listScopeRequests,
  resolveScopeRequest,
  type ScopeRequest,
} from "../../lib/api";
import { swallow } from "../../lib/log";
import styles from "./Employees.module.css";

// Org-delingskøen: dokumenter noen har bedt om å dele med hele
// organisasjonen. Én jobb: hev synligheten eller la den være på enheten.
export function Sharing() {
  const [list, setList] = useState<ScopeRequest[] | null>(null);

  useEffect(() => {
    listScopeRequests().then(setList).catch(() => setList([]));
  }, []);

  function resolve(r: ScopeRequest, approve: boolean) {
    setList((l) => l?.filter((x) => x.doc_id !== r.doc_id) ?? l);
    resolveScopeRequest(r.doc_id, approve).catch(swallow);
  }

  if (!list) return null;

  return (
    <div className={styles.content}>
      <div className={styles.intro}>
        Dokumenter som er bedt delt med hele organisasjonen. Godkjenn for å
        heve synligheten; avslå beholder dem hos enheten som lastet opp.
      </div>
      {list.length === 0 ? (
        <div className={styles.empty}>Ingen forespørsler venter.</div>
      ) : (
        <div className={styles.list}>
          {list.map((r) => (
            <div key={r.doc_id} className={styles.row}>
              <span className={styles.cell}>{r.title || r.doc_id}</span>
              <span className={styles.cell}>{r.requested_by}</span>
              <button className={styles.addBtn} onClick={() => resolve(r, true)}>
                Del med alle
              </button>
              <button className={styles.del} onClick={() => resolve(r, false)} aria-label="Avslå">
                Avslå
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
