import { useEffect, useState } from "react";
import {
  fetchAdminUsers,
  saveConnectionConfig,
  type AdminUser,
  type Connection,
  type ConnectionSchema,
} from "../../lib/api";
import styles from "./TableManager.module.css";
import { AccessEditor } from "./AccessEditor";
import { swallow } from "../../lib/log";

const SQL_KW = new Set(
  ("select from where join left right inner outer full cross on group order by " +
    "limit offset having distinct count sum avg min max as and or not in is null " +
    "like between union all case when then else end with asc desc").split(" ")
);

function highlightSql(sql: string) {
  return sql.split(/([a-zA-Z_]+|[^a-zA-Z_]+)/).map((tok, i) =>
    SQL_KW.has(tok.toLowerCase()) ? (
      <span key={i} className={styles.sqlKw}>
        {tok}
      </span>
    ) : (
      <span key={i}>{tok}</span>
    )
  );
}

// Kostnadsindikator: flere kolonner = mer kontekst per melding = dyrere.
// 5 segmenter fylles og skifter farge grønt → gult → rødt.
function CostBar({ cols }: { cols: number }) {
  const SEGS = 5;
  const level = Math.max(1, Math.min(SEGS, Math.ceil(cols / 6)));
  const label =
    level <= 3 ? "Lav kontekstkostnad" : level <= 5 ? "Middels — vurder å begrense kolonner" : "Høy — begrens kolonner via egen SQL";
  return (
    <span className={styles.costBar} title={`${cols} kolonner. ${label}.`}>
      {Array.from({ length: SEGS }, (_, i) => (
        <span
          key={i}
          className={`${styles.costSeg} ${i < level ? "" : styles.costSegEmpty}`}
          style={i < level ? { background: "#6ef16a" } : undefined}
        />
      ))}
    </span>
  );
}

// Rutenett for bordvalg, beskrivelse og tilgang per bord.
export function TableManager({
  conn,
  schema,
  onClose,
  onRemove,
}: {
  conn: Connection;
  schema: ConnectionSchema;
  onClose: () => void;
  onRemove?: () => void;
}) {
  const cfg = schema.config.tables ?? [];
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const views = schema.config.views ?? [];
  const defaultSql = (name: string) => `SELECT * FROM ${name};`;
  // Per bord: valgt, beskrivelse, tilgang (tom = alle), SQL-spørring.
  const [state, setState] = useState<
    Record<
      string,
      { on: boolean; desc: string; userIds: string[]; open: boolean; sql: string }
    >
  >(() =>
    Object.fromEntries(
      schema.tables.map((t) => {
        const c = cfg.find((x) => x.name === t.name);
        const v = views.find((x) => x.name === `${t.name}_query`);
        return [
          t.name,
          {
            on: Boolean(c),
            desc: c?.description ?? "",
            userIds: c?.user_ids ?? [],
            open: false,
            sql: v?.sql ?? defaultSql(t.name),
          },
        ];
      })
    )
  );

  useEffect(() => {
    fetchAdminUsers().then(setUsers).catch(swallow);
  }, []);

  const adminId = users.find((u) => u.role === "admin")?.id ?? "";
  const tables = schema.tables.filter((t) =>
    t.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const chosenCount = Object.values(state).filter((s) => s.on).length;

  function patch(name: string, p: Partial<(typeof state)[string]>) {
    setState((prev) => ({ ...prev, [name]: { ...prev[name], ...p } }));
  }

  // Slår man på et bord uten definert tilgang: standard er kun admin.
  function toggleTableOn(name: string, on: boolean) {
    setState((prev) => {
      const cur = prev[name];
      const userIds =
        on && cur.userIds.length === 0 && adminId ? [adminId] : cur.userIds;
      return { ...prev, [name]: { ...cur, on, open: on, userIds } };
    });
  }

  async function save() {
    setSaving(true);
    const cfgTables = Object.entries(state)
      .filter(([, s]) => s.on)
      .map(([name, s]) => ({
        name,
        description: s.desc,
        columns: {},
        user_ids: s.userIds,
      }));
    // Behold eksisterende relasjoner for bord som fortsatt er med.
    const names = new Set(cfgTables.map((t) => t.name));
    const links = (schema.config.links ?? []).filter(
      (l) => names.has(l.from_table) && names.has(l.to_table)
    );
    // SQL lagres kun som view når den avviker fra standard SELECT * FROM.
    const nextViews = Object.entries(state)
      .filter(([name, s]) => s.on && s.sql.trim() && s.sql.trim() !== defaultSql(name))
      .map(([name, s]) => ({ name: `${name}_query`, sql: s.sql.trim(), description: "" }));
    try {
      await saveConnectionConfig(conn.id, cfgTables, links, nextViews);
      setSaved(true);
      setTimeout(onClose, 700);
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className={styles.tmPage}>
      <div className={styles.tmHead}>
        <div>
          <div className={styles.sectionTitle}>{conn.name}</div>
          <div className={styles.sectionDesc}>
            Velg bordene AI-en får bruke, beskriv dem og styr tilgang.
          </div>
        </div>
        <div className={styles.headActions}>
          {onRemove && (
            <button className={styles.cancel} onClick={onRemove}>
              Fjern
            </button>
          )}
          <button className={styles.primary} onClick={save} disabled={saving || chosenCount === 0}>
            {saved ? "Lagret ✓" : saving ? "Lagrer …" : `Lagre (${chosenCount})`}
          </button>
        </div>
      </div>

      <input
        className={styles.tmSearch}
        placeholder="Søk i bord …"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className={styles.tmList}>
        {tables.map((t) => {
          const s = state[t.name];
          const lines = s.sql.split("\n").length;
          return (
            <div key={t.name} className={`${styles.tmRow} ${s.on ? styles.tmRowOn : ""}`}>
              <div
                className={styles.tmTop}
                onClick={() => patch(t.name, { open: !s.open })}
              >
                <input
                  type="checkbox"
                  checked={s.on}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => toggleTableOn(t.name, e.target.checked)}
                />
                <span className={styles.tableName}>{t.name}</span>
                <span className={styles.colCount}>{t.columns.length} felt</span>
                {s.on && (
                  <span className={styles.costWrap}>
                    <CostBar cols={t.columns.length} />
                  </span>
                )}
              </div>

              {s.open && (
                <div className={styles.tmPanel}>
                  <div className={styles.tmField}>
                    <input
                      className={styles.tmDesc}
                      placeholder="Hva inneholder bordet? (vises til AI-en)"
                      value={s.desc}
                      onChange={(e) => patch(t.name, { desc: e.target.value })}
                    />
                  </div>

                  <div className={styles.tmField}>
                    <div className={styles.sqlEditor}>
                      <div className={styles.sqlGutter}>
                        {Array.from({ length: lines }, (_, i) => (
                          <span key={i}>{i + 1}</span>
                        ))}
                      </div>
                      <div className={styles.sqlField}>
                        <pre className={styles.sqlHighlight} aria-hidden="true">
                          {highlightSql(s.sql)}
                          {"\n"}
                        </pre>
                        <textarea
                          className={styles.sqlInput}
                          value={s.sql}
                          spellCheck={false}
                          onChange={(e) => patch(t.name, { sql: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <AccessEditor
                    users={users}
                    userIds={s.userIds}
                    onChange={(ids) => patch(t.name, { userIds: ids })}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
