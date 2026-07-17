import { useMemo, useEffect, useRef, useState } from "react";
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
  const [canvas, setCanvas] = useState<{ conn: Connection | null } | null>(null);

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

  return (
    <div className={styles.content}>
      <div className={styles.section}>
        <div className={styles.head}>
          <div className={styles.sectionTitle}>Databaser</div>
          {!canvas && (
            <button className={styles.primary} onClick={() => setCanvas({ conn: null })}>
              Ny tilkobling
            </button>
          )}
        </div>
        <div className={styles.sectionDesc}>
          Koble til bedriftens egne databaser og velg hva AI-en får se.
        </div>

        {canvas && (
          <ChatWizard
            initialConn={canvas.conn}
            onClose={() => {
              setCanvas(null);
              reload();
            }}
          />
        )}

        {conns.length === 0 && !canvas && (
          <div className={styles.empty}>Ingen tilkoblinger ennå.</div>
        )}
        {conns.map((c) => (
          <div key={c.id} className={styles.connRow} onClick={() => setCanvas({ conn: c })}>
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

// --- Chat-basert oppsett ---

type Phase =
  | "creds"
  | "tables"
  | "sql"
  | "describe"
  | "relations"
  | "done";

interface Msg {
  id: number;
  role: "bot" | "user";
  text?: string;
  widget?: "creds" | "tables" | "sql" | "relations";
}

let msgId = 0;
const nextMsg = () => ++msgId;

function ChatWizard({
  initialConn,
  onClose,
}: {
  initialConn: Connection | null;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [phase, setPhase] = useState<Phase>("creds");
  const [conn, setConn] = useState<Connection | null>(initialConn);
  const [schema, setSchema] = useState<ConnectionSchema | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [describeQueue, setDescribeQueue] = useState<string[]>([]);
  const [links, setLinks] = useState<DbLink[]>([]);
  const [views, setViews] = useState<DbView[]>([]);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  function push(msg: Omit<Msg, "id">) {
    setMessages((prev) => [...prev, { ...msg, id: nextMsg() }]);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, phase]);

  // Åpning: ny tilkobling starter med kredensialer, eksisterende hopper
  // rett til bordvalg.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (initialConn) {
      push({ role: "bot", text: `Henter skjemaet fra ${initialConn.name} …` });
      loadSchema(initialConn);
    } else {
      push({ role: "bot", text: "La oss koble til en database. Fyll inn detaljene:" });
      push({ role: "bot", widget: "creds" });
    }
  }, []);

  async function loadSchema(c: Connection) {
    try {
      const s = await fetchConnectionSchema(c.id);
      setSchema(s);
      const cfg = s.config.tables ?? [];
      setSelected(new Set(cfg.map((t) => t.name)));
      setDescriptions(Object.fromEntries(cfg.map((t) => [t.name, t.description])));
      setLinks(s.config.links ?? []);
      setViews(s.config.views ?? []);
      setPhase("tables");
      push({
        role: "bot",
        text: `Jeg fant ${s.tables.length} bord. Velg de AI-en skal få bruke:`,
      });
      push({ role: "bot", widget: "tables" });
    } catch {
      push({ role: "bot", text: "Klarte ikke hente skjemaet. Sjekk tilkoblingen." });
    }
  }

  function onConnected(c: Connection) {
    setConn(c);
    push({ role: "user", text: `Koblet til ${c.name}` });
    push({ role: "bot", text: "Tilkoblet! Henter skjemaet …" });
    loadSchema(c);
  }

  function tablesDone() {
    if (selected.size === 0 && views.length === 0) return;
    push({
      role: "user",
      text: `Valgt: ${[...selected].join(", ")}${views.length ? ` + ${views.length} SQL` : ""}`,
    });
    setPhase("sql");
    push({
      role: "bot",
      text: "Vil du legge til en egen SQL-spørring (f.eks. en ferdig join)?",
    });
  }

  function startSql() {
    push({ role: "user", text: "Ja, lag en SQL-spørring" });
    push({ role: "bot", widget: "sql" });
  }

  function sqlDone(added: DbView | null) {
    if (added) {
      setViews((v) => [...v.filter((x) => x.name !== added.name), added]);
      push({ role: "user", text: `La til spørringen ${added.name}` });
      push({ role: "bot", text: "Flere spørringer?" });
      return;
    }
    startDescribe();
  }

  function startDescribe() {
    const queue = [...selected, ...views.map((v) => `${v.name} (SQL)`)];
    if (queue.length === 0) {
      startRelations();
      return;
    }
    setPhase("describe");
    setDescribeQueue(queue);
    push({
      role: "bot",
      text: `Beskriv kort hva ${queue[0].replace(" (SQL)", "")} inneholder (Enter for å hoppe over):`,
    });
  }

  function answerDescribe(text: string) {
    const [current, ...rest] = describeQueue;
    const key = current.replace(" (SQL)", "");
    if (text.trim()) {
      push({ role: "user", text: text.trim() });
      if (current.endsWith("(SQL)")) {
        setViews((v) => v.map((x) => (x.name === key ? { ...x, description: text.trim() } : x)));
      } else {
        setDescriptions((d) => ({ ...d, [key]: text.trim() }));
      }
    } else {
      push({ role: "user", text: "(hopper over)" });
    }
    if (rest.length > 0) {
      setDescribeQueue(rest);
      push({
        role: "bot",
        text: `Og ${rest[0].replace(" (SQL)", "")}?`,
      });
    } else {
      startRelations();
    }
  }

  function startRelations() {
    if (selected.size < 2) {
      finish();
      return;
    }
    setPhase("relations");
    push({
      role: "bot",
      text: "Til slutt: koble sammen bordene. Klikk en kolonne, så kolonnen den hører sammen med:",
    });
    push({ role: "bot", widget: "relations" });
  }

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
      setPhase("done");
      push({ role: "bot", text: `Ferdig! ${conn.name} er klar til bruk i chatten.` });
    } catch {
      push({ role: "bot", text: "Kunne ikke lagre. Prøv igjen." });
    } finally {
      setSaving(false);
    }
  }

  function submitInput(e: React.FormEvent) {
    e.preventDefault();
    if (phase !== "describe") return;
    const text = input;
    setInput("");
    answerDescribe(text);
  }

  const lastWidgetId = [...messages].reverse().find((m) => m.widget)?.id;
  const lastWidget = (w: Msg["widget"]) =>
    messages.find((m) => m.id === lastWidgetId)?.widget === w;
  const isLastWidgetMsg = (m: Msg) => m.id === lastWidgetId;

  return (
    <div className={styles.canvas}>
      <div className={styles.canvasScroll} ref={scrollRef}>
        {messages.map((m) => (
          <div
            key={m.id}
            className={`${styles.chatRow} ${m.role === "user" ? styles.chatUser : ""}`}
          >
            {m.text && <div className={styles.chatBubble}>{m.text}</div>}
            {m.widget === "creds" && isLastWidgetMsg(m) && phase === "creds" && (
              <div className={styles.chatWidget}>
                <CredsForm onConnected={onConnected} />
              </div>
            )}
            {m.widget === "tables" && isLastWidgetMsg(m) && phase === "tables" && schema && (
              <div className={styles.chatWidget}>
                <TablePicker
                  tables={schema.tables}
                  selected={selected}
                  setSelected={setSelected}
                />
                <div className={styles.formActions}>
                  <button
                    className={styles.primary}
                    onClick={tablesDone}
                    disabled={selected.size === 0 && views.length === 0}
                  >
                    Ferdig med valg
                  </button>
                </div>
              </div>
            )}
            {m.widget === "sql" && isLastWidgetMsg(m) && phase === "sql" && (
              <div className={styles.chatWidget}>
                <SqlComposer onDone={sqlDone} />
              </div>
            )}
            {m.widget === "relations" && isLastWidgetMsg(m) && phase === "relations" && schema && (
              <div className={styles.chatWidget}>
                <RelationGraph
                  tables={schema.tables.filter((t) => selected.has(t.name))}
                  suggestions={schema.suggested_links ?? []}
                  links={links}
                  setLinks={setLinks}
                />
                <div className={styles.formActions}>
                  <button className={styles.primary} onClick={finish} disabled={saving}>
                    {saving ? "Lagrer …" : "Fullfør"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {phase === "sql" && !lastWidget("sql") && (
          <div className={styles.chatChoices}>
            <button className={styles.chip} onClick={startSql}>
              Ja, lag en SQL-spørring
            </button>
            <button className={styles.chip} onClick={startDescribe}>
              Nei, gå videre
            </button>
          </div>
        )}
      </div>

      <form className={styles.canvasInputRow} onSubmit={submitInput}>
        <input
          className={styles.canvasInput}
          placeholder={
            phase === "describe" ? "Skriv beskrivelsen her …" : "Bruk valgene over …"
          }
          value={input}
          disabled={phase !== "describe"}
          onChange={(e) => setInput(e.target.value)}
          autoFocus={phase === "describe"}
        />
        <button
          type="button"
          className={styles.cancel}
          onClick={phase === "done" ? onClose : onClose}
        >
          {phase === "done" ? "Lukk" : "Avbryt"}
        </button>
      </form>
    </div>
  );
}

// Kredensial-skjema som chat-widget.
function CredsForm({ onConnected }: { onConnected: (c: Connection) => void }) {
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

// Bordvalg som chat-widget: søk + 5 per side.
const PAGE_SIZE = 5;

function TablePicker({
  tables,
  selected,
  setSelected,
}: {
  tables: DbTable[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(
    () => tables.filter((t) => t.name.toLowerCase().includes(query.toLowerCase())),
    [tables, query]
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  }

  return (
    <div className={styles.stepBody}>
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
          <button type="button" className={styles.cancel} disabled={page === 0} onClick={() => setPage(page - 1)}>
            Forrige
          </button>
          <span className={styles.pagerInfo}>
            {page + 1} / {pages}
          </span>
          <button type="button" className={styles.cancel} disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Neste
          </button>
        </div>
      )}
    </div>
  );
}

// SQL-editor som chat-widget.
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

function SqlComposer({ onDone }: { onDone: (v: DbView | null) => void }) {
  const [draft, setDraft] = useState<DbView>({ name: "", sql: "", description: "" });
  const lines = draft.sql.split("\n").length;

  return (
    <div className={styles.stepBody}>
      <input
        className={styles.input}
        placeholder="Navn (f.eks. ordre_per_kunde)"
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
      />
      <div className={styles.sqlEditor}>
        <div className={styles.sqlGutter}>
          {Array.from({ length: Math.max(lines, 4) }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <div className={styles.sqlField}>
          <pre className={styles.sqlHighlight} aria-hidden="true">
            {highlightSql(draft.sql)}
            {"\n"}
          </pre>
          <textarea
            className={styles.sqlInput}
            value={draft.sql}
            placeholder="SELECT c.name, SUM(o.total) FROM orders o JOIN customers c ON …"
            spellCheck={false}
            onChange={(e) => setDraft({ ...draft, sql: e.target.value })}
          />
        </div>
      </div>
      <div className={styles.formActions}>
        <button type="button" className={styles.cancel} onClick={() => onDone(null)}>
          Gå videre
        </button>
        <button
          type="button"
          className={styles.primary}
          disabled={!draft.name.trim() || !draft.sql.trim()}
          onClick={() => onDone(draft)}
        >
          Legg til
        </button>
      </div>
    </div>
  );
}

// Relasjonsgraf som chat-widget.
const NODE_W = 200;
const ROW_H = 22;
const HEAD_H = 30;
const GAP_X = 120;
const GAP_Y = 28;

function RelationGraph({
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

  if (tables.length < 2) return null;

  const width = 2 * NODE_W + GAP_X;

  return (
    <div className={styles.stepBody}>
      {usable.length > 0 && (
        <div className={styles.chips}>
          {usable.map((l) => (
            <button key={key(l)} type="button" className={styles.chip} onClick={() => setLinks([...links, l])}>
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
                  type="button"
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
