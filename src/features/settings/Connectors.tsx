import { useEffect, useState } from "react";
import chatStyles from "../chat/Chat.module.css";
import { Logo } from "../../ui/Logo";
import {
  completeChat,
  createConnection,
  deleteConnection,
  fetchAdminUsers,
  fetchConnections,
  fetchConnectionSchema,
  fetchMe,
  saveConnectionConfig,
  type AdminUser,
  type Connection,
  type ConnectionSchema,
  type DbLink,
} from "../../lib/api";
import styles from "./Connectors.module.css";

const DB_TYPES = [
  { key: "postgres", label: "PostgreSQL", port: 5432 },
  { key: "mysql", label: "MySQL", port: 3306 },
  { key: "mssql", label: "SQL Server", port: 1433 },
];

// Flowchart-data per tilkobling: valgte bord + relasjoner mellom dem.
interface FlowInfo {
  tables: string[];
  links: { from: string; to: string }[];
}

// Kjederekkefølge: forbundne bord legges ved siden av hverandre.
function chainOrder(tables: string[], links: { from: string; to: string }[]): string[] {
  const adj = new Map<string, string[]>();
  for (const l of links) {
    adj.set(l.from, [...(adj.get(l.from) ?? []), l.to]);
    adj.set(l.to, [...(adj.get(l.to) ?? []), l.from]);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tables) {
    if (seen.has(t)) continue;
    const stack = [t];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      out.push(cur);
      for (const n of adj.get(cur) ?? []) if (!seen.has(n)) stack.push(n);
    }
  }
  return out;
}

export function Connectors() {
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [flows, setFlows] = useState<Record<string, FlowInfo>>({});
  const [schemas, setSchemas] = useState<Record<string, ConnectionSchema>>({});
  const [popover, setPopover] = useState<{ connId: string; table: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canvas, setCanvas] = useState<{ conn: Connection | null } | null>(null);
  const [listView, setListView] = useState(false);

  function reload() {
    fetchConnections()
      .then((list) => {
        setConns(list);
        for (const c of list) {
          fetchConnectionSchema(c.id)
            .then((sch) => {
              setSchemas((prev) => ({ ...prev, [c.id]: sch }));
              const chosen = new Set((sch.config.tables ?? []).map((t) => t.name));
              const links = [
                ...(sch.config.links ?? []),
                ...(sch.suggested_links ?? []),
              ]
                .filter((l) => chosen.has(l.from_table) && chosen.has(l.to_table))
                .map((l) => ({ from: l.from_table, to: l.to_table }));
              setFlows((prev) => ({
                ...prev,
                [c.id]: { tables: [...chosen], links },
              }));
            })
            .catch(() => {});
        }
      })
      .catch(() => setError("Kunne ikke hente tilkoblinger."));
  }

  useEffect(reload, []);

  async function remove(conn: Connection) {
    if (!confirm(`Fjerne tilkoblingen ${conn.name}?`)) return;
    try {
      await deleteConnection(conn.id);
      reload();
    } catch {
      setError("Kunne ikke fjerne tilkoblingen.");
    }
  }

  if (error && !conns) return <div className={styles.error}>{error}</div>;
  if (!conns) return null;

  // Egen side: alle eksisterende koblinger som liste.
  if (listView) {
    return (
      <div className={styles.content}>
        <div className={styles.section}>
          <div className={styles.head}>
            <div className={styles.sectionTitle}>Eksisterende koblinger</div>
            <button className={styles.primary} onClick={() => setListView(false)}>
              Tilbake
            </button>
          </div>
          {conns.length === 0 && <div className={styles.empty}>Ingen tilkoblinger ennå.</div>}
          {conns.map((c) => (
            <div
              key={c.id}
              className={styles.connRow}
              onClick={() => {
                setListView(false);
                setCanvas({ conn: c });
              }}
            >
              <span className={styles.connName}>{c.name}</span>
              <span className={styles.connDriver}>
                {DB_TYPES.find((t) => t.key === c.driver)?.label ?? c.driver}
              </span>
              <button
                className={styles.remove}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(c);
                }}
              >
                Fjern
              </button>
            </div>
          ))}
          {error && <div className={styles.error}>{error}</div>}
        </div>
      </div>
    );
  }

  // Ny tilkobling tar over hele siden.
  if (canvas) {
    return (
      <ChatWizard
        initialConn={canvas.conn}
        onClose={() => {
          setCanvas(null);
          reload();
        }}
      />
    );
  }

  return (
    <div className={`${styles.content} ${styles.contentCentered}`}>
      <div className={styles.section}>
        <div className={styles.head}>
          <div className={styles.sectionTitle}>Databaser</div>
          <div className={styles.headActions}>
            <button className={styles.primary} onClick={() => setListView(true)}>
              Eksisterende koblinger
            </button>
            <button className={styles.primary} onClick={() => setCanvas({ conn: null })}>
              Ny tilkobling
            </button>
          </div>
        </div>
        <div className={styles.sectionDesc}>
          Koble til bedriftens egne databaser og velg hva AI-en får se.
        </div>

        <div className={styles.flowsCenter}>
        {conns.length === 0 && (
          <div className={styles.empty}>Ingen tilkoblinger ennå.</div>
        )}
        {conns.length > 0 && (
          <div className={styles.flowRow}>
            {conns.flatMap((c) => {
              const flow = flows[c.id];
              const order = flow ? chainOrder(flow.tables, flow.links) : [];
              const linked = (a: string, b: string) =>
                flow?.links.some(
                  (l) => (l.from === a && l.to === b) || (l.from === b && l.to === a)
                );
              return order.map((t, i) => (
                <span key={`${c.id}-${t}`} className={styles.flowSeg}>
                  {i > 0 && (
                    <span
                      className={linked(order[i - 1], t) ? styles.flowWire : styles.flowGap}
                    />
                  )}
                  {(() => {
                    const active = popover?.connId === c.id && popover?.table === t;
                    return (
                      <span
                        className={`${styles.flowNode} ${
                          active ? styles.flowNodeExpanded : ""
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPopover(active ? null : { connId: c.id, table: t });
                        }}
                      >
                        <span className={styles.flowNodeRow}>
                          <span className={`${styles.flowBadge} ${styles.flowBadgeBlue}`}>
                            <PlayGlyph />
                          </span>
                          <span className={styles.flowText}>
                            <span className={styles.flowTitle}>{t}</span>
                            <span className={styles.flowSub}>Bord ({c.name})</span>
                          </span>
                        </span>
                        {active && schemas[c.id] && (
                          <span
                            className={styles.flowNodeBody}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <NodeEditor
                              schema={schemas[c.id]}
                              table={t}
                              onSaved={reload}
                            />
                          </span>
                        )}
                      </span>
                    );
                  })()}
                </span>
              ));
            })}
          </div>
        )}
        {conns.length > 0 &&
          Object.keys(flows).length === conns.length &&
          conns.every((c) => (flows[c.id]?.tables.length ?? 0) === 0) && (
            <div className={styles.empty}>Ingen bord valgt ennå.</div>
          )}
        </div>
        {error && <div className={styles.error}>{error}</div>}
      </div>
    </div>
  );
}

// Canvas som åpnes ved «Ny tilkobling» — innholdet bygges videre senere.
// Ord-for-ord fade-in, samme animasjon som hovedchatten.
function FadeText({ text }: { text: string }) {
  const words = text.match(/\S+\s*/g) ?? [];
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (visible >= words.length) return;
    const t = setTimeout(() => setVisible((v) => v + 1), 120);
    return () => clearTimeout(t);
  }, [visible, words.length]);

  return (
    <span className={chatStyles.streamingText}>
      {words.slice(0, visible).map((w, i) => (
        <span key={i} className={chatStyles.fadeSeg}>
          {w}
        </span>
      ))}
    </span>
  );
}

// Enkel av/på-bryter i Guardrails-stil.
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`${styles.toggle} ${on ? styles.toggleOn : ""}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span className={styles.toggleKnob} />
    </button>
  );
}

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

// Innhold i en ekspandert node: beskrivelse, relasjon-toggle, custom SQL-toggle.
function NodeEditor({
  schema,
  table,
  onSaved,
}: {
  schema: ConnectionSchema;
  table: string;
  onSaved: () => void;
}) {
  const cfgTables = schema.config.tables ?? [];
  // Alle bord i databasen kan kobles til — ikke bare de allerede valgte.
  const others = schema.tables.map((t) => t.name).filter((n) => n !== table);
  const myCols = schema.tables.find((t) => t.name === table)?.columns ?? [];
  const viewName = `${table}_query`;

  const initialDesc = cfgTables.find((t) => t.name === table)?.description ?? "";
  const initialLinks = (schema.config.links ?? []).filter(
    (l) => l.from_table === table || l.to_table === table
  );
  const initialView = (schema.config.views ?? []).find((v) => v.name === viewName);

  const [description, setDescription] = useState(initialDesc);
  const [relOn, setRelOn] = useState(initialLinks.length > 0);
  const [links, setLinks] = useState<DbLink[]>(initialLinks);
  const [sqlOn, setSqlOn] = useState(Boolean(initialView));
  const [sql, setSql] = useState(initialView?.sql ?? "");
  const [saving, setSaving] = useState(false);

  const [fromCol, setFromCol] = useState("");
  const [toTable, setToTable] = useState("");
  const [toCol, setToCol] = useState("");
  const toCols = schema.tables.find((t) => t.name === toTable)?.columns ?? [];

  function addLink() {
    if (!fromCol || !toTable || !toCol) return;
    setLinks((prev) => [
      ...prev,
      { from_table: table, from_column: fromCol, to_table: toTable, to_column: toCol },
    ]);
    setFromCol("");
    setToTable("");
    setToCol("");
  }

  async function save() {
    setSaving(true);
    try {
      const tables = cfgTables.map((t) =>
        t.name === table ? { ...t, description } : t
      );
      const otherLinks = (schema.config.links ?? []).filter(
        (l) => l.from_table !== table && l.to_table !== table
      );
      const keptLinks = relOn ? [...otherLinks, ...links] : otherLinks;
      // Bord som en relasjon peker på må også være tilgjengelige for AI-en.
      const known = new Set(tables.map((t) => t.name));
      for (const l of keptLinks) {
        for (const name of [l.from_table, l.to_table]) {
          if (!known.has(name)) {
            known.add(name);
            tables.push({ name, description: "", columns: {}, user_ids: [] });
          }
        }
      }
      const otherViews = (schema.config.views ?? []).filter((v) => v.name !== viewName);
      const views =
        sqlOn && sql.trim()
          ? [...otherViews, { name: viewName, sql: sql.trim(), description: "" }]
          : otherViews;
      await saveConnectionConfig(schema.connection.id, tables, keptLinks, views);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const lines = sql.split("\n").length;

  return (
    <span className={styles.nodeEditor}>
      <span className={styles.nodeField}>
        <span className={styles.nodeFieldLabel}>Beskrivelse</span>
        <textarea
          className={styles.nodeArea}
          placeholder="Hva inneholder bordet? (vises til AI-en)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          autoFocus
        />
      </span>

      <span className={styles.nodeToggleRow}>
        <span className={styles.nodeToggleLabel}>Relasjon</span>
        <Toggle on={relOn} onChange={setRelOn} />
      </span>
      {relOn && (
        <span className={styles.nodeSub}>
          {links.map((l, i) => (
            <span key={i} className={styles.relLink}>
              <span className={styles.relLinkText}>
                {l.from_table}.{l.from_column}
                <span className={styles.relEq}>=</span>
                {l.to_table}.{l.to_column}
              </span>
              <button
                className={styles.remove}
                onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
              >
                Fjern
              </button>
            </span>
          ))}
          {others.length > 0 ? (
            <span className={styles.relForm}>
              <span className={styles.relField}>
                <span className={styles.relLabel}>Nøkkel i {table}</span>
                <select
                  className={styles.relSelect}
                  value={fromCol}
                  onChange={(e) => setFromCol(e.target.value)}
                >
                  <option value="">Velg kolonne …</option>
                  {myCols.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </span>
              <span className={styles.relField}>
                <span className={styles.relLabel}>Kobles til bord</span>
                <select
                  className={styles.relSelect}
                  value={toTable}
                  onChange={(e) => {
                    setToTable(e.target.value);
                    setToCol("");
                  }}
                >
                  <option value="">Velg bord …</option>
                  {others.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </span>
              <span className={styles.relField}>
                <span className={styles.relLabel}>På kolonne</span>
                <select
                  className={styles.relSelect}
                  value={toCol}
                  onChange={(e) => setToCol(e.target.value)}
                  disabled={!toTable}
                >
                  <option value="">Velg kolonne …</option>
                  {toCols.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </span>
              <button
                className={styles.relAddBtn}
                onClick={addLink}
                disabled={!fromCol || !toTable || !toCol}
              >
                Legg til relasjon
              </button>
            </span>
          ) : (
            <span className={styles.nodeHint}>
              Ingen andre bord i denne databasen.
            </span>
          )}
        </span>
      )}

      <span className={styles.nodeToggleRow}>
        <span className={styles.nodeToggleLabel}>Custom SQL</span>
        <Toggle on={sqlOn} onChange={setSqlOn} />
      </span>
      {sqlOn && (
        <span className={styles.sqlEditor}>
          <span className={styles.sqlGutter}>
            {Array.from({ length: Math.max(lines, 3) }, (_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </span>
          <span className={styles.sqlField}>
            <pre className={styles.sqlHighlight} aria-hidden="true">
              {highlightSql(sql)}
              {"\n"}
            </pre>
            <textarea
              className={styles.sqlInput}
              value={sql}
              placeholder={`SELECT * FROM ${table} JOIN …`}
              spellCheck={false}
              onChange={(e) => setSql(e.target.value)}
            />
          </span>
        </span>
      )}

      <button className={styles.nodeSave} onClick={save} disabled={saving}>
        {saving ? "Lagrer …" : "Lagre"}
      </button>
    </span>
  );
}

function PlayGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

const SOURCE_OPTIONS = ["Database", "Databricks", "CSV", "Excel", "Cloud Storage"];

const DRIVER_MAP: Record<string, { key: string; port: number; user: string }> = {
  PostgreSQL: { key: "postgres", port: 5432, user: "postgres" },
  MySQL: { key: "mysql", port: 3306, user: "root" },
  "SQL Server": { key: "mssql", port: 1433, user: "sa" },
};

// Predefinert skript for database-flyten: ett felt om gangen, med
// naturlige forslag i komboboksen. Ingen AI = ingen tokens.
interface FlowStep {
  key: string;
  question: string;
  options: (answers: Record<string, string>) => string[];
  secret?: boolean;
}

const DB_FLOW: FlowStep[] = [
  {
    key: "driver",
    question: "Hvilken databasetype?",
    options: () => Object.keys(DRIVER_MAP),
  },
  {
    key: "name",
    question: "Hva skal tilkoblingen hete?",
    options: () => ["Regnskap", "CRM", "Salg", "Lager"],
  },
  {
    key: "host",
    question: "Hvilken host kjører databasen på?",
    options: () => ["localhost"],
  },
  {
    key: "port",
    question: "Hvilken port?",
    options: (a) => [String(DRIVER_MAP[a.driver]?.port ?? 5432)],
  },
  {
    key: "database",
    question: "Hva heter databasen?",
    options: () => [],
  },
  {
    key: "user",
    question: "Hvilket brukernavn skal jeg logge inn med?",
    options: (a) => [DRIVER_MAP[a.driver]?.user ?? "postgres"].filter(Boolean),
  },
  {
    key: "password",
    question: "Og passordet? (lagres kryptert)",
    options: () => [],
    secret: true,
  },
];

interface LogMsg {
  id: number;
  role: "bot" | "user";
  text: string;
}

let logId = 0;

// Tilgang per bord: søk + Enter legger til bruker som rad. Tom = alle.
function AccessEditor({
  users,
  userIds,
  onChange,
}: {
  users: AdminUser[];
  userIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const added = users.filter((u) => userIds.includes(u.id));
  const matches = users.filter(
    (u) =>
      !userIds.includes(u.id) &&
      u.email.toLowerCase().includes(query.trim().toLowerCase())
  );

  function add(id: string) {
    onChange([...userIds, id]);
    setQuery("");
  }

  return (
    <div className={styles.acc}>
      <div className={styles.accSearchWrap}>
        <input
          className={styles.accSearch}
          placeholder="Søk og legg til bruker …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches.length > 0) {
              e.preventDefault();
              add(matches[0].id);
            }
          }}
        />
        {query.trim() && matches.length > 0 && (
          <div className={styles.accMenu}>
            {matches.slice(0, 5).map((u) => (
              <button key={u.id} className={styles.accMenuItem} onClick={() => add(u.id)}>
                {u.email}
              </button>
            ))}
          </div>
        )}
      </div>

      <table className={styles.accTable}>
        <tbody>
          {added.length === 0 ? (
            <tr>
              <td className={styles.accAllCell}>Alle brukere</td>
              <td className={styles.accAllCell}>Full</td>
            </tr>
          ) : (
            added.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td className={styles.accTh2}>
                  <button
                    className={styles.remove}
                    onClick={() => onChange(userIds.filter((id) => id !== u.id))}
                  >
                    Fjern
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// Rutenett for bordvalg, beskrivelse og tilgang per bord.
function TableManager({
  conn,
  schema,
  onClose,
}: {
  conn: Connection;
  schema: ConnectionSchema;
  onClose: () => void;
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
    fetchAdminUsers().then(setUsers).catch(() => {});
  }, []);

  const tables = schema.tables.filter((t) =>
    t.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const chosenCount = Object.values(state).filter((s) => s.on).length;

  function patch(name: string, p: Partial<(typeof state)[string]>) {
    setState((prev) => ({ ...prev, [name]: { ...prev[name], ...p } }));
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
          <button className={styles.cancel} onClick={onClose}>
            Avbryt
          </button>
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
              <label className={styles.tmTop}>
                <input
                  type="checkbox"
                  checked={s.on}
                  onChange={(e) => patch(t.name, { on: e.target.checked, open: e.target.checked })}
                />
                <span className={styles.tableName}>{t.name}</span>
                <span className={styles.colCount}>{t.columns.length} felt</span>
                {s.on && (
                  <button
                    type="button"
                    className={styles.tmExpand}
                    onClick={(e) => {
                      e.preventDefault();
                      patch(t.name, { open: !s.open });
                    }}
                  >
                    {s.open ? "Skjul" : "Rediger"}
                  </button>
                )}
              </label>

              {s.on && s.open && (
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

function ChatWizard(_props: {
  initialConn: Connection | null;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  const [hilite, setHilite] = useState(0);
  const [log, setLog] = useState<LogMsg[]>([]);
  const [sourceChosen, setSourceChosen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // Felt under korrigering — overstyrer den lineære rekkefølgen.
  const [editKey, setEditKey] = useState<string | null>(null);
  const [savedConn, setSavedConn] = useState<Connection | null>(null);
  const [schema, setSchema] = useState<ConnectionSchema | null>(null);
  const [selTables, setSelTables] = useState<Set<string>>(new Set());
  const [tablesDone, setTablesDone] = useState(false);
  const [busy, setBusy] = useState(false);
  // Pågående handling: vises med logo-animasjon som i hovedchatten.
  const [status, setStatus] = useState<string | null>(null);

  // Etter bordvalg: AI sparrer om beskrivelser, så settes tilganger.
  // stage2: "" | "describe" | "access" | "done"
  const [stage2, setStage2] = useState("");
  const [descQueue, setDescQueue] = useState<string[]>([]);
  const [descs, setDescs] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [meId, setMeId] = useState("");
  const [selUsers, setSelUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchAdminUsers().then(setUsers).catch(() => {});
    fetchMe().then((r) => setMeId(r.user.id)).catch(() => {});
  }, []);

  // Redigering av eksisterende kobling: hopp rett til rutenettet.
  useEffect(() => {
    if (!_props.initialConn) return;
    setSavedConn(_props.initialConn);
    fetchConnectionSchema(_props.initialConn.id).then(setSchema).catch(() => {});
  }, []);

  // Aktivt felt utledes av svarene: eksplisitt korrigering vinner, ellers
  // første ubesvarte felt. Alt besvart -> null (klar/tilkoblet).
  const activeStep: FlowStep | null = !sourceChosen
    ? null
    : (editKey && DB_FLOW.find((f) => f.key === editKey)) ||
      DB_FLOW.find((f) => !(f.key in answers)) ||
      null;

  const tablesPhase = Boolean(savedConn && schema && !tablesDone && !activeStep);
  const describePhase = stage2 === "describe";
  const accessPhase = stage2 === "access";
  const curDescTable = describePhase ? descQueue[0] : undefined;

  const DONE_ITEM = "__done__";
  const ALL_ITEM = "__all__";
  const ME_ITEM = "__me__";

  const question = !sourceChosen
    ? "Hva skal vi koble til?"
    : activeStep?.question ??
      (tablesPhase
        ? "Hvilke bord skal AI-en få bruke?"
        : accessPhase
          ? "Hvem skal ha tilgang til dataene?"
          : null);

  const rawOptions = !sourceChosen
    ? SOURCE_OPTIONS
    : activeStep
      ? activeStep.options(answers)
      : tablesPhase && schema
        ? schema.tables.map((t) => t.name)
        : accessPhase
          ? users.map((u) => u.email)
          : [];
  const filtered = rawOptions.filter((o) =>
    o.toLowerCase().includes(input.trim().toLowerCase())
  );
  const options = tablesPhase
    ? [...(selTables.size > 0 ? [DONE_ITEM] : []), ...filtered.slice(0, 5)]
    : accessPhase
      ? [
          ...(selUsers.size > 0 ? [DONE_ITEM] : [ALL_ITEM, ME_ITEM]),
          ...filtered.slice(0, 5),
        ]
      : filtered;

  function say(role: "bot" | "user", text: string) {
    setLog((prev) => [...prev, { id: ++logId, role, text }]);
  }

  async function connect(a: Record<string, string>) {
    if (busy) return;
    setBusy(true);
    setStatus("Tester tilkoblingen");
    try {
      const conn = await createConnection({
        name: a.name,
        driver: DRIVER_MAP[a.driver]?.key ?? "postgres",
        host: a.host,
        port: Number(a.port) || 5432,
        database: a.database,
        user: a.user,
        password: a.password ?? "",
      });
      // Korrigering etter vellykket oppkobling: den nye erstatter den gamle.
      if (savedConn) await deleteConnection(savedConn.id).catch(() => {});
      setSavedConn(conn);
      setStatus("Henter skjemaet");
      const sch = await fetchConnectionSchema(conn.id);
      setSchema(sch);
      setStatus(null);
      say("bot", `Tilkoblet! Jeg fant ${sch.tables.length} bord i databasen.`);
    } catch (err) {
      setStatus(null);
      say("bot", (err instanceof Error ? err.message : "Kunne ikke koble til.") + " Prøv passordet igjen.");
      setAnswers((prev) => {
        const next = { ...prev };
        delete next.password;
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  function acceptAnswer(step: FlowStep, value: string) {
    const next = { ...answers, [step.key]: value };
    setAnswers(next);
    setEditKey(null);
    // Alt besvart? Da (re)kobler vi.
    if (DB_FLOW.every((f) => f.key in next)) {
      connect(next);
    }
  }

  // Fritekst som ikke matcher et forslag: agenten tolker svaret i kontekst
  // og bestemmer om det er et gyldig feltsvar eller trenger oppfølging.
  async function askAgent(step: FlowStep | null, value: string) {
    setStatus("Tenker");
    try {
      const strictNote =
        step?.key === "driver"
          ? ` Feltet har FASTE gyldige verdier: ${Object.keys(DRIVER_MAP).join(", ")}. accept=true KUN hvis svaret entydig er en av disse (value = eksakt verdi fra listen). Andre databasetyper støttes ikke.`
          : "";
      const context =
        step === null
          ? `Brukeren velger datakilde. Gyldige valg: ${SOURCE_OPTIONS.join(", ")}. Kun Database er støttet foreløpig.`
          : `Spørsmålet til brukeren var: "${step.question}" (felt: ${step.key} i en databasetilkobling).` + strictNote;
      const fields = DB_FLOW.map((f) => f.key).join(", ");
      const answered = Object.entries(answers)
        .filter(([k]) => k !== "password")
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      const raw = await completeChat("bris", [
        {
          role: "system",
          content:
            "Du hjelper en bruker å sette opp en databasetilkobling, felt for felt. " +
            context +
            (answered ? ` Allerede besvart: ${answered}.` : "") +
            ' Vurder brukerens svar. Svar KUN med JSON: {"accept": true/false, "value": "<feltverdien>", "goto": "<feltnavn eller null>", "reply": "<kort norsk melding>"}. ' +
            "accept=true hvis svaret kan brukes som verdi for feltet (value = normalisert verdi). " +
            "For frie felter (name, host, database, user) er ethvert rimelig ord eller navn gyldig — aksepter det som det er. " +
            "accept=false KUN hvis svaret åpenbart er tastetull, et spørsmål, eller en instruks om noe annet. " +
            'Eksempler (felt name): "Flyttest" -> {"accept":true,"value":"Flyttest","goto":null,"reply":""}. ' +
            '"Regnskapsbasen vår" -> {"accept":true,"value":"Regnskapsbasen","goto":null,"reply":""}. ' +
            '"asdkjhasd" -> {"accept":false,"goto":null,"reply":"Det ser ut som tastetull - gi tilkoblingen et beskrivende navn."}. ' +
            '"vent, jeg vil bytte databasetype" -> {"accept":false,"goto":"driver","reply":"Ok, vi tar databasetypen på nytt."}. ' +
            `Hvis brukeren vil endre et TIDLIGERE felt (${fields}), sett goto til det feltet. ` +
            'Hvis brukeren vil endre selve datakilden (angrer på valget Database/CSV osv., eller sier han svarte feil uten at noe felt er besvart ennå), sett goto til "source". ' +
            "reply skal ALDRI gjenta eller stille selve feltspørsmålet — det stilles automatisk etterpå. Hold reply til én kort setning, eller tom streng.",
        },
        { role: "user", content: value },
      ]);
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      setStatus(null);
      if (parsed.goto === "source") {
        if (parsed.reply) say("bot", parsed.reply);
        setSourceChosen(false);
        setAnswers({});
        setEditKey(null);
        return;
      }
      const gotoStep = parsed.goto ? DB_FLOW.find((f) => f.key === parsed.goto) : null;
      if (gotoStep) {
        if (parsed.reply) say("bot", parsed.reply);
        // Feltet nullstilles slik at flowen naturlig spør om det igjen.
        setAnswers((prev) => {
          const next = { ...prev };
          delete next[gotoStep.key];
          return next;
        });
        setEditKey(gotoStep.key);
      } else if (step && parsed.accept && parsed.value) {
        if (step.key === "driver" && !Object.keys(DRIVER_MAP).includes(String(parsed.value))) {
          say("bot", "Vi støtter PostgreSQL, MySQL og SQL Server foreløpig.");
        } else {
          acceptAnswer(step, String(parsed.value));
        }
      } else {
        say("bot", parsed.reply || "Det forsto jeg ikke — prøv igjen.");
      }
    } catch {
      setStatus(null);
      say("bot", "Det forsto jeg ikke helt — prøv igjen.");
    }
  }

  // Limt inn en hel connection-string? Parse den lokalt og fyll alle felt.
  function tryConnectionString(text: string): boolean {
    const m = text.match(
      /\b(postgres(?:ql)?|mysql|sqlserver|mssql):\/\/(?:([^:@\s]+)(?::([^@\s]+))?@)?([^:\/@\s]+)(?::(\d+))?(?:\/([^?\s]+))?/i
    );
    if (!m) return false;
    const [, proto, user, pass, host, port, db] = m;
    const driver = /^postgres/i.test(proto)
      ? "PostgreSQL"
      : /^mysql/i.test(proto)
        ? "MySQL"
        : "SQL Server";
    say("user", text.replace(pass ?? "", pass ? "••••" : ""));
    const next: Record<string, string> = { ...answers, driver };
    if (host) next.host = host;
    next.port = port || String(DRIVER_MAP[driver].port);
    if (db) next.database = db;
    if (user) next.user = user;
    if (pass) next.password = decodeURIComponent(pass);
    if (!answers.name && !next.name) {
      // Navn mangler ofte i strengen — behold det som eneste spørsmål.
    }
    setAnswers(next);
    setEditKey(null);
    setInput("");
    setHilite(0);
    say("bot", "Fant tilkoblingsdetaljene i strengen.");
    if (DB_FLOW.every((f) => f.key in next)) connect(next);
    return true;
  }

  function answer(text: string) {
    if (!text.trim()) return;
    const value = text.trim();

    if (!sourceChosen) {
      say("user", value);
      setInput("");
      setHilite(0);
      if (value === "Database") {
        setSourceChosen(true);
        return;
      }
      if (SOURCE_OPTIONS.includes(value)) {
        say("bot", `${value} kommer snart — foreløpig støtter vi Database.`);
        return;
      }
      askAgent(null, value);
      return;
    }

    if (tryConnectionString(value)) return;

    const step = activeStep;
    say("user", step?.secret ? "••••••••" : value);
    setInput("");
    setHilite(0);
    if (!step) {
      // Alt er besvart: fritekst her er korrigering eller spørsmål — agenten
      // ruter til riktig felt via goto.
      askAgent(null, value);
      return;
    }
    // Menyvalg (eller passord) går rett gjennom skriptet; annen fritekst
    // vurderes av agenten.
    const isSuggestion = step.options(answers).includes(value);
    if (isSuggestion || step.secret) {
      acceptAnswer(step, value);
    } else {
      askAgent(step, value);
    }
  }

  function toggleTable(name: string) {
    setSelTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setInput("");
    setHilite(0);
  }

  // Etter bordvalg: AI vurderer skjemaene, foreslår beskrivelser og flagger
  // det den mener er unødvendig. Ett samlekall = token-effektivt.
  async function finishTables() {
    if (!savedConn || !schema) return;
    say("user", `Valgte bord: ${[...selTables].join(", ")}`);
    setTablesDone(true);
    setStatus("Vurderer skjemaene");
    const picked = [...selTables];
    const schemaText = picked
      .map((name) => {
        const cols = schema.tables.find((t) => t.name === name)?.columns ?? [];
        return `${name}(${cols.map((c) => `${c.name} ${c.type}`).join(", ")})`;
      })
      .join("\n");
    try {
      const raw = await completeChat("bris", [
        {
          role: "system",
          content:
            "Du hjelper en admin å sette opp en database for et AI-verktøy. " +
            "For hvert bord: skriv en kort norsk beskrivelse (én setning) og flagg " +
            "bord eller kolonner som virker unødvendige/sensitive for en AI-assistent " +
            "(f.eks. passord-hasher, interne id-er, tekniske logger). " +
            'Svar KUN med JSON: {"tables":[{"name":"...","description":"...","note":"kort råd eller tom"}]}.',
        },
        { role: "user", content: schemaText },
      ]);
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      const byName: Record<string, { description: string; note: string }> = {};
      for (const t of parsed.tables ?? []) {
        byName[t.name] = { description: t.description ?? "", note: t.note ?? "" };
      }
      const suggestions: Record<string, string> = {};
      for (const name of picked) suggestions[name] = byName[name]?.description ?? "";
      setDescs(suggestions);
      setStatus(null);
      const flagged = picked.filter((n) => byName[n]?.note);
      if (flagged.length > 0) {
        say(
          "bot",
          "Noen ting jeg vil peke på: " +
            flagged.map((n) => `${n} — ${byName[n].note}`).join(" · ")
        );
      }
      setDescQueue(picked);
      setStage2("describe");
      say(
        "bot",
        `Forslag til beskrivelse for ${picked[0]}: «${suggestions[picked[0]]}». Trykk Enter for å godta, eller skriv din egen.`
      );
    } catch {
      // AI feilet: hopp rett til tilgang uten forslag.
      setDescs(Object.fromEntries(picked.map((n) => [n, ""])));
      setStatus(null);
      setStage2("access");
      say("bot", "Hvem skal ha tilgang til dataene?");
    }
  }

  function answerDescribe(text: string) {
    const [current, ...rest] = descQueue;
    const value = text.trim() || descs[current] || "";
    setDescs((d) => ({ ...d, [current]: value }));
    say("user", value || "(ingen beskrivelse)");
    setInput("");
    if (rest.length > 0) {
      setDescQueue(rest);
      say(
        "bot",
        `Forslag for ${rest[0]}: «${descs[rest[0]] ?? ""}». Enter for å godta, eller skriv din egen.`
      );
    } else {
      setDescQueue([]);
      setStage2("access");
      say("bot", "Hvem skal ha tilgang til dataene?");
    }
  }

  async function finishAccess(ids: string[], label: string) {
    if (!savedConn) return;
    say("user", label);
    setStatus("Lagrer");
    try {
      await saveConnectionConfig(
        savedConn.id,
        [...selTables].map((name) => ({
          name,
          description: descs[name] ?? "",
          columns: {},
          user_ids: ids,
        })),
        [],
        []
      );
      setStatus(null);
      setStage2("done");
      say("bot", `Ferdig! ${savedConn.name} er klar til bruk i chatten.`);
    } catch {
      setStatus(null);
      say("bot", "Kunne ikke lagre. Prøv igjen.");
    }
  }

  function toggleUser(email: string) {
    const u = users.find((x) => x.email === email);
    if (!u) return;
    setSelUsers((prev) => {
      const next = new Set(prev);
      if (next.has(u.id)) next.delete(u.id);
      else next.add(u.id);
      return next;
    });
    setInput("");
    setHilite(0);
  }

  function pick(option: string) {
    if (tablesPhase) {
      if (option === DONE_ITEM) finishTables();
      else toggleTable(option);
      return;
    }
    if (accessPhase) {
      if (option === ALL_ITEM) finishAccess([], "Alle brukere");
      else if (option === ME_ITEM) finishAccess(meId ? [meId] : [], "Kun meg");
      else if (option === DONE_ITEM)
        finishAccess(
          [...selUsers],
          `Tilgang: ${users.filter((u) => selUsers.has(u.id)).map((u) => u.email).join(", ")}`
        );
      else toggleUser(option);
      return;
    }
    answer(option);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHilite((h) => Math.min(h + 1, options.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHilite((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (describePhase) {
        answerDescribe(input);
        return;
      }
      if (tablesPhase || accessPhase) {
        if (options.length > 0) pick(options[hilite]);
        return;
      }
      if (input.trim()) answer(input);
      else if (options.length > 0) answer(options[hilite]);
    }
  }

  // Så snart kilden er tilkoblet: chat er ferdig, rutenettet tar over.
  if (savedConn && schema) {
    return <TableManager conn={savedConn} schema={schema} onClose={_props.onClose} />;
  }

  return (
    <div className={styles.createPage}>
      <div className={styles.sectionTitle}>Opprett kobling</div>
      <div className={styles.canvas}>
        <div className={styles.canvasCenter}>
          {log.map((m) => (
            <div
              key={m.id}
              className={m.role === "bot" ? styles.canvasQuestion : styles.canvasChoice}
            >
              {m.text}
            </div>
          ))}
          {question && (
            <div className={styles.canvasQuestion} key={`q-${activeStep?.key ?? "source"}`}>
              <FadeText text={question} />
            </div>
          )}
          {status && (
            <div className={chatStyles.step}>
              <span className={chatStyles.thinkingLogo}>
                <Logo size={10} flutter glow="#ffffff" />
              </span>
              <span className={chatStyles.stepActive}>{status} …</span>
            </div>
          )}
        </div>
      </div>
      <div className={chatStyles.composerDocked}>
        <div className={chatStyles.composerWrap}>
          <div className={chatStyles.composer}>
            <div className={chatStyles.inputRow}>
              <textarea
                className={chatStyles.input}
                rows={1}
                placeholder={
                  status
                    ? "Vent litt …"
                    : describePhase && curDescTable
                      ? `Beskrivelse for ${curDescTable} …`
                      : "Spør om hva som helst …"
                }
                value={input}
                disabled={status !== null || busy}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
            </div>
            {options.length > 0 && !describePhase && (
              <div className={styles.comboBody}>
                <div className={styles.comboLabel}>
                  {!sourceChosen
                    ? "Kilder"
                    : tablesPhase
                      ? "Bord"
                      : accessPhase
                        ? "Tilgang"
                        : "Forslag"}
                </div>
                {options.map((o, i) => (
                  <button
                    key={o}
                    type="button"
                    className={`${styles.comboItem} ${i === hilite ? styles.comboItemActive : ""}`}
                    onMouseEnter={() => setHilite(i)}
                    onClick={() => pick(o)}
                  >
                    <span
                      className={`${styles.comboDot} ${
                        (tablesPhase && (o === DONE_ITEM || selTables.has(o))) ||
                        (accessPhase &&
                          (o === DONE_ITEM ||
                            selUsers.has(users.find((u) => u.email === o)?.id ?? "")))
                          ? styles.comboDotOn
                          : ""
                      }`}
                    />
                    <span className={styles.comboItemLabel}>
                      {o === DONE_ITEM
                        ? `Ferdig (${(tablesPhase ? selTables.size : selUsers.size)} valgt)`
                        : o === ALL_ITEM
                          ? "Alle brukere"
                          : o === ME_ITEM
                            ? "Kun meg"
                            : o}
                    </span>
                    {tablesPhase && o !== DONE_ITEM && (
                      <span className={styles.comboHint}>
                        {schema?.tables.find((t) => t.name === o)?.columns.length} felt
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <div className={chatStyles.footer}>
              <span className={chatStyles.modelInfo}>Modell: Bris</span>
              <span className={chatStyles.sendHint}>
                Send <span className={chatStyles.kbd}>↵</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
