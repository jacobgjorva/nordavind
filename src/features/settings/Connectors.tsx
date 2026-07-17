import { useEffect, useState } from "react";
import {
  createConnection,
  testConnection,
  deleteConnection,
  fetchAdminUsers,
  fetchConnections,
  fetchConnectionSchema,
  saveConnectionConfig,
  type AdminUser,
  type Connection,
  type ConnectionSchema,
  type DbLink,
  type TableConfig,
} from "../../lib/api";
import styles from "./Connectors.module.css";

const DB_TYPES = [
  { key: "postgres", label: "PostgreSQL", port: 5432 },
  { key: "mysql", label: "MySQL", port: 3306 },
  { key: "mssql", label: "SQL Server", port: 1433 },
];

// Kuratering per tabell mens admin redigerer.
interface TableDraft {
  enabled: boolean;
  description: string;
  columns: Record<string, string>;
  userIds: string[];
  open: boolean;
}

export function Connectors() {
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [selected, setSelected] = useState<Connection | null>(null);
  const [schema, setSchema] = useState<ConnectionSchema | null>(null);
  const [drafts, setDrafts] = useState<Record<string, TableDraft>>({});
  const [links, setLinks] = useState<DbLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  function reload() {
    fetchConnections()
      .then(setConns)
      .catch(() => setError("Kunne ikke hente tilkoblinger."));
  }

  useEffect(() => {
    reload();
    fetchAdminUsers().then(setUsers).catch(() => {});
  }, []);

  async function open(conn: Connection) {
    setSelected(conn);
    setSchema(null);
    setError(null);
    setLoading(true);
    try {
      const s = await fetchConnectionSchema(conn.id);
      setSchema(s);
      const cfg = new Map(
        (s.config.tables ?? []).map((t: TableConfig) => [t.name, t])
      );
      const d: Record<string, TableDraft> = {};
      for (const t of s.tables) {
        const c = cfg.get(t.name);
        d[t.name] = {
          enabled: Boolean(c),
          description: c?.description ?? "",
          columns: c?.columns ?? {},
          userIds: c?.user_ids ?? [],
          open: false,
        };
      }
      setDrafts(d);
      setLinks(s.config.links ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke koble til.");
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!selected) return;
    const tables: TableConfig[] = Object.entries(drafts)
      .filter(([, d]) => d.enabled)
      .map(([name, d]) => ({
        name,
        description: d.description,
        columns: d.columns,
        user_ids: d.userIds,
      }));
    const names = new Set(tables.map((t) => t.name));
    try {
      await saveConnectionConfig(
        selected.id,
        tables,
        links.filter((l) => names.has(l.from_table) && names.has(l.to_table))
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Kunne ikke lagre.");
    }
  }

  async function remove(conn: Connection) {
    if (!confirm(`Fjerne tilkoblingen ${conn.name}?`)) return;
    try {
      await deleteConnection(conn.id);
      if (selected?.id === conn.id) {
        setSelected(null);
        setSchema(null);
      }
      reload();
    } catch {
      setError("Kunne ikke fjerne tilkoblingen.");
    }
  }

  function patch(name: string, p: Partial<TableDraft>) {
    setDrafts((prev) => ({ ...prev, [name]: { ...prev[name], ...p } }));
  }

  if (error && !conns) return <div>{error}</div>;
  if (!conns) return null;

  return (
    <div className={styles.content}>
      <div className={styles.section}>
        <div className={styles.head}>
          <div className={styles.sectionTitle}>Databaser</div>
          {!formOpen && (
            <button className={styles.primary} onClick={() => setFormOpen(true)}>
              Ny tilkobling
            </button>
          )}
        </div>
        <div className={styles.sectionDesc}>
          Koble til bedriftens egne databaser og velg hva AI-en får se.
        </div>

        {formOpen && (
          <NewConnectionForm
            onCancel={() => setFormOpen(false)}
            onCreated={(c) => {
              setFormOpen(false);
              reload();
              open(c);
            }}
          />
        )}

        {conns.length === 0 && !formOpen && (
          <div className={styles.empty}>Ingen tilkoblinger ennå.</div>
        )}
        {conns.map((c) => (
          <div
            key={c.id}
            className={`${styles.connRow} ${selected?.id === c.id ? styles.connActive : ""}`}
            onClick={() => open(c)}
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
      </div>

      {error && conns && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.empty}>Henter skjema …</div>}

      {schema && selected && (
        <div className={styles.section}>
          <div className={styles.head}>
            <div className={styles.sectionTitle}>Tabeller i {selected.name}</div>
            <button className={styles.primary} onClick={save}>
              {saved ? "Lagret ✓" : "Lagre"}
            </button>
          </div>
          <div className={styles.sectionDesc}>
            Velg tabellene AI-en får bruke, beskriv innholdet og styr hvem som
            har tilgang.
          </div>

          {schema.tables.map((t) => {
            const d = drafts[t.name];
            if (!d) return null;
            return (
              <div key={t.name} className={styles.tableCard}>
                <div className={styles.tableHead}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      onChange={(e) => patch(t.name, { enabled: e.target.checked })}
                    />
                    <span className={styles.tableName}>{t.name}</span>
                    <span className={styles.colCount}>{t.columns.length} felt</span>
                  </label>
                  {d.enabled && (
                    <button
                      className={styles.expand}
                      onClick={() => patch(t.name, { open: !d.open })}
                    >
                      {d.open ? "Skjul detaljer" : "Detaljer"}
                    </button>
                  )}
                </div>

                {d.enabled && (
                  <input
                    className={styles.input}
                    placeholder="Hva inneholder tabellen? (vises til AI-en)"
                    value={d.description}
                    onChange={(e) => patch(t.name, { description: e.target.value })}
                  />
                )}

                {d.enabled && d.open && (
                  <div className={styles.details}>
                    <div className={styles.detailLabel}>Felt (beskrivelse valgfri)</div>
                    {t.columns.map((col) => (
                      <div key={col.name} className={styles.colRow}>
                        <span className={styles.colName}>
                          {col.name}
                          <span className={styles.colType}>{col.type}</span>
                        </span>
                        <input
                          className={styles.colInput}
                          placeholder="Beskrivelse"
                          value={d.columns[col.name] ?? ""}
                          onChange={(e) =>
                            patch(t.name, {
                              columns: { ...d.columns, [col.name]: e.target.value },
                            })
                          }
                        />
                      </div>
                    ))}

                    <div className={styles.detailLabel}>Tilgang</div>
                    <div className={styles.userChips}>
                      <button
                        className={`${styles.chip} ${d.userIds.length === 0 ? styles.chipOn : ""}`}
                        onClick={() => patch(t.name, { userIds: [] })}
                      >
                        Alle
                      </button>
                      {users.map((u) => {
                        const on = d.userIds.includes(u.id);
                        return (
                          <button
                            key={u.id}
                            className={`${styles.chip} ${on ? styles.chipOn : ""}`}
                            onClick={() =>
                              patch(t.name, {
                                userIds: on
                                  ? d.userIds.filter((id) => id !== u.id)
                                  : [...d.userIds, u.id],
                              })
                            }
                          >
                            {u.email}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <LinkEditor
            schema={schema}
            drafts={drafts}
            links={links}
            setLinks={setLinks}
          />
        </div>
      )}
    </div>
  );
}

function NewConnectionForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (c: Connection) => void;
}) {
  const [driver, setDriver] = useState("postgres");
  const [form, setForm] = useState({
    name: "",
    host: "",
    port: 5432,
    database: "",
    user: "",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<"idle" | "testing" | "ok">("idle");

  async function test() {
    if (busy || testState === "testing") return;
    setTestState("testing");
    setError(null);
    try {
      await testConnection({ ...form, driver });
      setTestState("ok");
      setTimeout(() => setTestState("idle"), 3000);
    } catch (err) {
      setTestState("idle");
      setError(err instanceof Error ? err.message : "Kunne ikke koble til.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const conn = await createConnection({ ...form, driver });
      onCreated(conn);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke koble til.");
    } finally {
      setBusy(false);
    }
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: k === "port" ? Number(e.target.value) : e.target.value }));

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Type</span>
          <select
            className={styles.select}
            value={driver}
            onChange={(e) => {
              setDriver(e.target.value);
              const t = DB_TYPES.find((x) => x.key === e.target.value);
              if (t) setForm((f) => ({ ...f, port: t.port }));
            }}
          >
            {DB_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Navn</span>
          <input className={styles.input} placeholder="Regnskap" value={form.name} onChange={set("name")} required />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Host</span>
          <input className={styles.input} placeholder="localhost" value={form.host} onChange={set("host")} required />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Port</span>
          <input className={styles.input} type="number" placeholder="5432" value={form.port} onChange={set("port")} required />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Database</span>
          <input className={styles.input} placeholder="crm_db" value={form.database} onChange={set("database")} required />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Bruker</span>
          <input className={styles.input} placeholder="postgres" value={form.user} onChange={set("user")} required />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Passord</span>
          <input className={styles.input} type="password" placeholder="••••••••" value={form.password} onChange={set("password")} />
        </label>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.formActions}>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          Avbryt
        </button>
        <button
          type="button"
          className={`${styles.primary} ${testState === "ok" ? styles.testOk : ""}`}
          onClick={test}
          disabled={testState === "testing"}
        >
          {testState === "testing"
            ? "Tester …"
            : testState === "ok"
              ? "Tilkobling OK ✓"
              : "Test tilkobling"}
        </button>
        <button className={styles.primary} disabled={busy}>
          {busy ? "Kobler til …" : "Koble til"}
        </button>
      </div>
    </form>
  );
}

// Join-nøkler: foreslåtte fremmednøkler + manuell kobling tabell.kolonne = tabell.kolonne.
function LinkEditor({
  schema,
  drafts,
  links,
  setLinks,
}: {
  schema: ConnectionSchema;
  drafts: Record<string, TableDraft>;
  links: DbLink[];
  setLinks: (l: DbLink[]) => void;
}) {
  const enabled = schema.tables.filter((t) => drafts[t.name]?.enabled);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const key = (l: DbLink) => `${l.from_table}.${l.from_column}=${l.to_table}.${l.to_column}`;
  const have = new Set(links.map(key));
  const suggestions = (schema.suggested_links ?? []).filter(
    (l) =>
      !have.has(key(l)) &&
      drafts[l.from_table]?.enabled &&
      drafts[l.to_table]?.enabled
  );

  const options = enabled.flatMap((t) =>
    t.columns.map((c) => `${t.name}.${c.name}`)
  );

  function addManual() {
    const [ft, fc] = from.split(".");
    const [tt, tc] = to.split(".");
    if (!ft || !fc || !tt || !tc) return;
    const l = { from_table: ft, from_column: fc, to_table: tt, to_column: tc };
    if (!have.has(key(l))) setLinks([...links, l]);
    setFrom("");
    setTo("");
  }

  if (enabled.length < 2) return null;

  return (
    <div className={styles.linkSection}>
      <div className={styles.detailLabel}>Koblinger mellom tabeller (join-nøkler)</div>

      {links.map((l) => (
        <div key={key(l)} className={styles.linkRow}>
          <span className={styles.linkText}>
            {l.from_table}.{l.from_column} <span className={styles.linkEq}>=</span> {l.to_table}.{l.to_column}
          </span>
          <button className={styles.remove} onClick={() => setLinks(links.filter((x) => key(x) !== key(l)))}>
            Fjern
          </button>
        </div>
      ))}

      {suggestions.length > 0 && (
        <div className={styles.suggestions}>
          <span className={styles.detailLabel}>Funnet i databasen:</span>
          {suggestions.map((l) => (
            <button key={key(l)} className={styles.chip} onClick={() => setLinks([...links, l])}>
              + {l.from_table}.{l.from_column} = {l.to_table}.{l.to_column}
            </button>
          ))}
        </div>
      )}

      <div className={styles.formRow}>
        <select className={styles.select} value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">Fra kolonne …</option>
          {options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <select className={styles.select} value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Til kolonne …</option>
          {options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <button type="button" className={styles.primary} onClick={addManual} disabled={!from || !to}>
          Koble
        </button>
      </div>
    </div>
  );
}
