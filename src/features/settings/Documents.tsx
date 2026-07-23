import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete01Icon } from "@hugeicons/core-free-icons";
import { listDocuments, deleteDocument, type LibraryDocument } from "../../lib/api";
import { swallow } from "../../lib/log";
import styles from "./Documents.module.css";

// Dokumentbibliotek: søk-først liste over opplastede dokumenter. Selve
// innholdet ligger som lapper i kunnskaps-skuffen; her ser og sletter man dem.
export function Documents() {
  const [docs, setDocs] = useState<LibraryDocument[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    listDocuments().then(setDocs).catch(() => setDocs([]));
  }, []);

  async function remove(id: string, title: string) {
    if (!confirm(`Slette «${title}» fra kunnskapen?`)) return;
    setDocs((d) => d?.filter((x) => x.id !== id) ?? d);
    deleteDocument(id).catch(swallow);
  }

  if (!docs) return null;

  const q = query.trim().toLowerCase();
  const rows = q
    ? docs.filter((d) => (d.title + " " + d.filename).toLowerCase().includes(q))
    : docs;

  return (
    <div className={styles.content}>
      <input
        className={styles.search}
        placeholder="Søk i dokumenter …"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {rows.length === 0 ? (
        <div className={styles.empty}>
          {docs.length === 0
            ? "Ingen dokumenter ennå. Last opp et i chatten og si «lagre»."
            : "Ingen treff."}
        </div>
      ) : (
        <div className={styles.list}>
          {rows.map((d) => (
            <div key={d.id} className={styles.row}>
              <div className={styles.meta}>
                <span className={styles.title}>{d.title || d.filename}</span>
                <span className={styles.sub}>
                  {d.filename} · {d.notes} lapper
                </span>
              </div>
              <button
                className={styles.del}
                onClick={() => remove(d.id, d.title || d.filename)}
                aria-label="Slett"
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
