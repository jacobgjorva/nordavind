import { useMemo, useEffect, useState } from "react";
import {
  createConnection,
  testConnection,
  deleteConnection,
  fetchConnections,
  fetchConnectionSchema,
  saveConnectionConfig,
  type Connection,
  type ConnectionSchema,
  type DbLink,
  type DbTable,
  type DbView,
  type TableConfig,
} from "../../lib/api";
import styles from "./Connectors.module.css";

const DB_TYPES = [
  { key: "postgres", label: "PostgreSQL", port: 5432 },
  { key: "mysql", label: "MySQL", port: 3306 },
  { key: "mssql", label: "SQL Server", port: 1433 },
];

export function Connectors() {
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Wizard: null = lukket, ellers { conn: null (steg 1) | Connection (steg 2+) }
  const [wizard, setWizard] = useState<{ conn: Connection | null } | null>(null);

  function reload() {
    fetchConnections()
      .then(setConns)
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

  if (wizard) {
    return (
      <Wizard
        initialConn={wizard.conn}
        onClose={() => {
          setWizard(null);
          reload();
        }}
      />
    );
  }

  return (
    <div className={styles.content}>
      <div className={styles.section}>
        <div className={styles.head}>
          <div className={styles.sectionTitle}>Databaser</div>
          <button className={styles.primary} onClick={() => setWizard({ conn: null })}>
            Ny tilkobling
          </button>
        </div>
        <div className={styles.sectionDesc}>
          Koble til bedriftens egne databaser og velg hva AI-en får se.
        </div>

        {conns.length === 0 && <div className={styles.empty}>Ingen tilkoblinger ennå.</div>}
        {conns.map((c) => (
          <div key={c.id} className={styles.connRow} onClick={() => setWizard({ conn: c })}>
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

// --- Wizard ---

const STEPS = ["Koble til", "Velg bord", "Beskriv", "Relasjoner"];

function Wizard({
  initialConn,
  onClose,
}: {
  initialConn: Connection | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState(initialConn ? 1 : 0);
  const [conn, setConn] = useState<Connection | null>(initialConn);
  const [schema, setSchema] = useState<ConnectionSchema | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<DbLink[]>([]);
  const [views, setViews] = useState<DbView[]>([]);
  const [saving, setSaving] = useState(false);

  async function loadSchema(c: Connection) {
    setError(null);
    try {
      const s = await fetchConnectionSchema(c.id);
      setSchema(s);
      const cfg = s.config.tables ?? [];
      setSelected(new Set(cfg.map((t) => t.name)));
      setDescriptions(Object.fromEntries(cfg.map((t) => [t.name, t.description])));
      setLinks(s.config.links ?? []);
      setViews(s.config.views ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke hente skjema.");
    }
  }

  useEffect(() => {
    if (initialConn) loadSchema(initialConn);
  }, []);

  async function finish() {
    if (!conn) return;
    setSaving(true);
    const tables: TableConfig[] = [...selected].map((name) => ({
      name,
      description: descriptions[name] ?? "",
      columns: {},
      user_ids: [],
    }));
    try {
      await saveConnectionConfig(
        conn.id,
        tables,
        links.filter((l) => selected.has(l.from_table) && selected.has(l.to_table)),
        views
      );
      onClose();
    } catch {
      setError("Kunne ikke lagre.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.content}>
      <div className={styles.wizardHead}>
        {STEPS.map((s, i) => (
          <button
            key={s}
            className={`${styles.wizStep} ${i === step ? styles.wizStepActive : ""} ${
              i < step ? styles.wizStepDone : ""
            }`}
            disabled={i > 0 && !conn}
            onClick={() => conn && setStep(i)}
          >
            <span className={styles.wizNum}>{i + 1}</span>
            {s}
          </button>
        ))}
        <button className={styles.cancel} onClick={onClose}>
          Lukk
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {step === 0 && (
        <ConnectStep
          onConnected={(c) => {
            setConn(c);
            loadSchema(c);
            setStep(1);
          }}
        />
      )}

      {step === 1 && schema && (
        <TableStep
          schema={schema}
          selected={selected}
          setSelected={setSelected}
          views={views}
          setViews={setViews}
        />
      )}

      {step === 2 && schema && (
        <DescribeStep
          selected={[...selected]}
          descriptions={descriptions}
          setDescriptions={setDescriptions}
        />
      )}

      {step === 3 && schema && (
        <RelationStep
          tables={schema.tables.filter((t) => selected.has(t.name))}
          suggestions={schema.suggested_links ?? []}
          links={links}
          setLinks={setLinks}
        />
      )}

      {step > 0 && (
        <div className={styles.wizardFoot}>
          <button className={styles.cancel} onClick={() => setStep(step - 1)} disabled={step === 1 && !initialConn}>
            Tilbake
          </button>
          {step < 3 ? (
            <button className={styles.primary} onClick={() => setStep(step + 1)}>
              Neste
            </button>
          ) : (
            <button className={styles.primary} onClick={finish} disabled={saving}>
              {saving ? "Lagrer …" : "Fullfør"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Steg 1: tilkoblingsskjema.
function ConnectStep({ onConnected }: { onConnected: (c: Connection) => void }) {
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
      onConnected(await createConnection({ ...form, driver }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke koble til.");
    } finally {
      setBusy(false);
    }
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: k === "port" ? Number(e.target.value) : e.target.value }));

  const canConnect =
    form.name.trim() && form.host.trim() && form.database.trim() && form.user.trim();

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
        <button
          type="button"
          className={`${styles.primary} ${testState === "ok" ? styles.testOk : ""}`}
          onClick={test}
          disabled={testState === "testing"}
        >
          {testState === "testing" ? "Tester …" : testState === "ok" ? "Tilkobling OK ✓" : "Test tilkobling"}
        </button>
        <button className={styles.primary} disabled={!canConnect || busy}>
          {busy ? "Kobler til …" : "Koble til"}
        </button>
      </div>
    </form>
  );
}

// SQL-editor med syntaksfarging: et gjennomsiktig textarea over et
// farget speil-lag, pluss linjenummer-renne.
const SQL_KEYWORDS = new Set(
  ("select from where join left right inner outer full cross on group order by " +
    "limit offset having distinct count sum avg min max as and or not in is null " +
    "like between union all case when then else end with asc desc").split(" ")
);

function highlightSql(sql: string) {
  return sql.split(/([a-zA-Z_]+|[^a-zA-Z_]+)/).map((tok, i) =>
    SQL_KEYWORDS.has(tok.toLowerCase()) ? (
      <span key={i} className={styles.sqlKw}>
        {tok}
      </span>
    ) : (
      <span key={i}>{tok}</span>
    )
  );
}

function SqlEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const lines = value.split("\n").length;
  return (
    <div className={styles.sqlEditor}>
      <div className={styles.sqlGutter}>
        {Array.from({ length: Math.max(lines, 4) }, (_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
      <div className={styles.sqlField}>
        <pre className={styles.sqlHighlight} aria-hidden="true">
          {highlightSql(value)}
          {"\n"}
        </pre>
        <textarea
          className={styles.sqlInput}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

// Steg 2: bordvalg med søk/paginering + custom SQL-spørringer.
const PAGE_SIZE = 5;

function TableStep({
  schema,
  selected,
  setSelected,
  views,
  setViews,
}: {
  schema: ConnectionSchema;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  views: DbView[];
  setViews: (v: DbView[]) => void;
}) {
  const [tab, setTab] = useState<"tables" | "sql">("tables");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState<DbView>({ name: "", sql: "", description: "" });

  const filtered = useMemo(
    () => schema.tables.filter((t) => t.name.toLowerCase().includes(query.toLowerCase())),
    [schema.tables, query]
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  }

  function addView() {
    if (!draft.name.trim() || !draft.sql.trim()) return;
    setViews([...views.filter((v) => v.name !== draft.name), draft]);
    setDraft({ name: "", sql: "", description: "" });
  }

  return (
    <div className={styles.stepBody}>
      <div className={styles.tabRow}>
        <button
          className={`${styles.tab} ${tab === "tables" ? styles.tabActive : ""}`}
          onClick={() => setTab("tables")}
        >
          Bord{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
        <button
          className={`${styles.tab} ${tab === "sql" ? styles.tabActive : ""}`}
          onClick={() => setTab("sql")}
        >
          SQL Query{views.length > 0 ? ` (${views.length})` : ""}
        </button>
      </div>

      {tab === "sql" && (
        <>
      {views.map((v) => (
        <div key={v.name} className={styles.viewRow}>
          <span className={styles.tableName}>{v.name}</span>
          <code className={styles.viewSql}>{v.sql}</code>
          <button className={styles.remove} onClick={() => setViews(views.filter((x) => x.name !== v.name))}>
            Fjern
          </button>
        </div>
      ))}
      <div className={styles.viewEditor}>
        <input
          className={styles.input}
          placeholder="Navn (f.eks. ordre_per_kunde)"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <SqlEditor
          value={draft.sql}
          placeholder="SELECT c.name, SUM(o.total) FROM orders o JOIN customers c ON …"
          onChange={(sql) => setDraft({ ...draft, sql })}
        />
        <input
          className={styles.input}
          placeholder="Beskrivelse (valgfri)"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
        <div className={styles.formActions}>
          <button className={styles.primary} onClick={addView} disabled={!draft.name.trim() || !draft.sql.trim()}>
            Legg til
          </button>
        </div>
      </div>
        </>
      )}

      {tab === "tables" && (
        <>
      <input
        className={styles.input}
        placeholder="Søk i bord …"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(0);
        }}
      />
      {visible.map((t) => (
        <label key={t.name} className={styles.pickRow}>
          <input type="checkbox" checked={selected.has(t.name)} onChange={() => toggle(t.name)} />
          <span className={styles.tableName}>{t.name}</span>
          <span className={styles.colCount}>{t.columns.length} felt</span>
        </label>
      ))}
      {pages > 1 && (
        <div className={styles.pager}>
          <button className={styles.cancel} disabled={page === 0} onClick={() => setPage(page - 1)}>
            Forrige
          </button>
          <span className={styles.pagerInfo}>
            {page + 1} / {pages}
          </span>
          <button className={styles.cancel} disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Neste
          </button>
        </div>
      )}
        </>
      )}
    </div>
  );
}

// Steg 3: beskrivelse per valgt bord.
function DescribeStep({
  selected,
  descriptions,
  setDescriptions,
}: {
  selected: string[];
  descriptions: Record<string, string>;
  setDescriptions: (d: Record<string, string>) => void;
}) {
  if (selected.length === 0) {
    return <div className={styles.empty}>Ingen bord valgt.</div>;
  }
  return (
    <div className={styles.stepBody}>
      {selected.map((name) => (
        <label key={name} className={styles.field}>
          <span className={`${styles.fieldLabel} ${styles.tableName}`}>{name}</span>
          <input
            className={styles.input}
            placeholder="Hva inneholder bordet?"
            value={descriptions[name] ?? ""}
            onChange={(e) => setDescriptions({ ...descriptions, [name]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}

// Steg 4: relasjonsbygger — klikk en kolonne, så en kolonne i et annet
// bord for å trekke en tråd mellom dem.
const NODE_W = 200;
const ROW_H = 22;
const HEAD_H = 30;
const GAP_X = 120;
const GAP_Y = 28;

function RelationStep({
  tables,
  suggestions,
  links,
  setLinks,
}: {
  tables: DbTable[];
  suggestions: DbLink[];
  links: DbLink[];
  setLinks: (l: DbLink[]) => void;
}) {
  const [pending, setPending] = useState<{ table: string; column: string } | null>(null);

  // Grid-layout: to kolonner med noder, y akkumuleres per kolonne.
  const layout = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    const colY = [0, 0];
    tables.forEach((t, i) => {
      const col = i % 2;
      pos[t.name] = { x: col * (NODE_W + GAP_X), y: colY[col] };
      colY[col] += HEAD_H + t.columns.length * ROW_H + GAP_Y;
    });
    return { pos, height: Math.max(colY[0], colY[1], 120) };
  }, [tables]);

  const key = (l: DbLink) => `${l.from_table}.${l.from_column}=${l.to_table}.${l.to_column}`;
  const have = new Set(links.map(key));
  const usable = suggestions.filter(
    (l) => !have.has(key(l)) && layout.pos[l.from_table] && layout.pos[l.to_table]
  );

  function clickColumn(table: string, column: string) {
    if (!pending) {
      setPending({ table, column });
      return;
    }
    if (pending.table === table) {
      setPending(column === pending.column ? null : { table, column });
      return;
    }
    const l: DbLink = {
      from_table: pending.table,
      from_column: pending.column,
      to_table: table,
      to_column: column,
    };
    if (!have.has(key(l))) setLinks([...links, l]);
    setPending(null);
  }

  // Ankerpunkt for en kolonne: midt på raden, høyre/venstre kant.
  function anchor(table: string, column: string, side: "left" | "right") {
    const p = layout.pos[table];
    const t = tables.find((x) => x.name === table);
    if (!p || !t) return { x: 0, y: 0 };
    const idx = t.columns.findIndex((c) => c.name === column);
    return {
      x: p.x + (side === "right" ? NODE_W : 0),
      y: p.y + HEAD_H + idx * ROW_H + ROW_H / 2,
    };
  }

  if (tables.length < 2) {
    return <div className={styles.empty}>Velg minst to bord for å bygge relasjoner.</div>;
  }

  const width = 2 * NODE_W + GAP_X;

  return (
    <div className={styles.stepBody}>
      {usable.length > 0 && (
        <div className={styles.chips}>
          {usable.map((l) => (
            <button key={key(l)} className={styles.chip} onClick={() => setLinks([...links, l])}>
              + {l.from_table}.{l.from_column} = {l.to_table}.{l.to_column}
            </button>
          ))}
        </div>
      )}

      <div className={styles.graphWrap} style={{ height: layout.height + 16 }}>
        <svg width={width} height={layout.height} className={styles.graphLinks}>
          {links
            .filter((l) => layout.pos[l.from_table] && layout.pos[l.to_table])
            .map((l) => {
              const fromLeft = layout.pos[l.from_table].x < layout.pos[l.to_table].x;
              const a = anchor(l.from_table, l.from_column, fromLeft ? "right" : "left");
              const b = anchor(l.to_table, l.to_column, fromLeft ? "left" : "right");
              const mx = (a.x + b.x) / 2;
              return (
                <path
                  key={key(l)}
                  d={`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`}
                  className={styles.wire}
                  onClick={() => setLinks(links.filter((x) => key(x) !== key(l)))}
                >
                  <title>
                    {l.from_table}.{l.from_column} = {l.to_table}.{l.to_column} (klikk for å fjerne)
                  </title>
                </path>
              );
            })}
        </svg>

        {tables.map((t) => {
          const p = layout.pos[t.name];
          return (
            <div key={t.name} className={styles.node} style={{ left: p.x, top: p.y, width: NODE_W }}>
              <div className={styles.nodeHead}>{t.name}</div>
              {t.columns.map((c) => (
                <button
                  key={c.name}
                  className={`${styles.nodeCol} ${
                    pending?.table === t.name && pending?.column === c.name ? styles.nodeColActive : ""
                  }`}
                  onClick={() => clickColumn(t.name, c.name)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
