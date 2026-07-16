
import { useState } from "react";
import { CopyIcon, PlusIcon } from "../../ui/Icons";
import styles from "./Connectors.module.css";

type DbType = "postgres" | "mysql" | "mssql" | "sqlite";

const DB_TYPES: { key: DbType; label: string }[] = [
  { key: "postgres", label: "PostgreSQL" },
  { key: "mysql", label: "MySQL" },
  { key: "mssql", label: "SQL Server" },
  { key: "sqlite", label: "SQLite" },
];

const PROVIDERS = ["Anthropic", "OpenAI", "Google", "Mistral", "Ollama"];

type ApiKey = { id: string; provider: string; key: string };

let keyCounter = 0;
const nextKeyId = () => `k${++keyCounter}`;

const SQL_KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "ON",
  "GROUP",
  "ORDER",
  "BY",
  "LIMIT",
  "AND",
  "OR",
  "AS",
  "DISTINCT",
  "COUNT",
]);

function tableTag(sql: string): string {
  const match = sql.match(/\bfrom\s+([a-zA-Z0-9_."[\]]+)/i);
  if (!match) return "dbo.—";
  const table = match[1].replace(/["[\]]/g, "");
  return table.includes(".") ? table : `dbo.${table}`;
}

function highlightSql(sql: string) {
  return sql.split(/(\s+|;|,|\*|\(|\))/).map((tok, i) => {
    if (SQL_KEYWORDS.has(tok.toUpperCase())) {
      return (
        <span key={i} className={styles.sqlKw}>
          {tok}
        </span>
      );
    }
    return <span key={i}>{tok}</span>;
  });
}

export function Connectors() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [adding, setAdding] = useState<{ provider: string; key: string } | null>(
    null
  );
  const [formOpen, setFormOpen] = useState(false);
  const [dbType, setDbType] = useState<DbType>("postgres");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [useSsh, setUseSsh] = useState(false);
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshPort, setSshPort] = useState("");
  const [connected, setConnected] = useState(false);
  const [query, setQuery] = useState("SELECT * FROM customers;");
  const [linkState, setLinkState] = useState<"idle" | "connecting" | "linked">(
    "idle"
  );
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok">("idle");

  function handleLink() {
    setLinkState("connecting");
    setTimeout(() => setLinkState("linked"), 5000);
  }

  const canConnect = host.trim() && database.trim() && username.trim();

  function handleTest() {
    setTestStatus("testing");
    setTimeout(() => setTestStatus("ok"), 900);
  }

  function handleConnect() {
    setConnected(true);
    setFormOpen(false);
  }

  function handleDisconnect() {
    setConnected(false);
    setFormOpen(false);
    setLinkState("idle");
    setTestStatus("idle");
    setHost("");
    setPort("");
    setDatabase("");
    setUsername("");
    setPassword("");
    setUseSsh(false);
    setSshHost("");
    setSshUser("");
    setSshPort("");
  }

  function updateKey(id: string, patch: Partial<ApiKey>) {
    setApiKeys((prev) => prev.map((k) => (k.id === id ? { ...k, ...patch } : k)));
  }

  function commitNewKey() {
    if (!adding || !adding.provider || !adding.key.trim()) return;
    setApiKeys((prev) => [
      ...prev,
      { id: nextKeyId(), provider: adding.provider, key: adding.key.trim() },
    ]);
    setAdding(null);
  }

  function removeKey(id: string) {
    setApiKeys((prev) => prev.filter((k) => k.id !== id));
  }

  return (
    <div className={styles.content}>
      <div className={styles.card}>
        <div className={styles.cardTitle}>API-nøkler</div>
        <div className={styles.cardBody}>
          <div className={styles.keyList}>
            {apiKeys.map((k) => (
              <div key={k.id} className={styles.keyRow}>
                <span className={styles.providerTag}>{k.provider}</span>

                <div className={`${styles.terminal} ${styles.terminalSmall}`}>
                  <div className={styles.terminalInner}>
                    <input
                      type="password"
                      className={styles.keyInput}
                      value={k.key}
                      onChange={(e) => updateKey(k.id, { key: e.target.value })}
                      placeholder="sk-…"
                    />
                    <button
                      type="button"
                      className={styles.copyIconButton}
                      onClick={() => k.key && navigator.clipboard?.writeText(k.key)}
                      aria-label="Kopier"
                    >
                      <CopyIcon size={15} />
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className={styles.removeKey}
                  onClick={() => removeKey(k.id)}
                  aria-label="Fjern nøkkel"
                >
                  <PlusIcon size={16} />
                </button>
              </div>
            ))}

            {adding ? (
              <div className={styles.addForm}>
                {!adding.provider ? (
                  <div className={styles.providerMenu}>
                    {PROVIDERS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={styles.providerOption}
                        onClick={() => setAdding({ ...adding, provider: p })}
                      >
                        {p}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={styles.providerCancel}
                      onClick={() => setAdding(null)}
                    >
                      Avbryt
                    </button>
                  </div>
                ) : (
                  <div className={styles.addKeyRow}>
                    <span className={styles.providerTag}>{adding.provider}</span>
                    <div className={`${styles.terminal} ${styles.terminalSmall}`}>
                      <div className={styles.terminalInner}>
                        <input
                          type="password"
                          className={styles.keyInput}
                          value={adding.key}
                          onChange={(e) =>
                            setAdding({ ...adding, key: e.target.value })
                          }
                          placeholder="sk-…"
                          autoFocus
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => setAdding(null)}
                    >
                      Avbryt
                    </button>
                    <button
                      type="button"
                      className={styles.btnDark}
                      disabled={!adding.key.trim()}
                      onClick={commitNewKey}
                    >
                      Legg til
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                className={styles.addKey}
                onClick={() => setAdding({ provider: "", key: "" })}
              >
                Legg til nøkkel
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={`${styles.card} ${styles.cardStack}`}>
        <div className={styles.cardTitle}>Intern database</div>

        <div className={styles.cardBody}>
          {formOpen ? (
            <>
              <div className={`${styles.dbPanel} ${styles.formStack}`}>
                <div className={styles.formCols}>
                <div className={styles.formCol}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Type</span>
                    <select
                      className={styles.select}
                      value={dbType}
                      onChange={(e) => setDbType(e.target.value as DbType)}
                    >
                      {DB_TYPES.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Host</span>
                    <input
                      className={styles.input}
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="localhost"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Port</span>
                    <input
                      className={styles.input}
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      placeholder="5432"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Database</span>
                    <input
                      className={styles.input}
                      value={database}
                      onChange={(e) => setDatabase(e.target.value)}
                      placeholder="crm_db"
                    />
                  </label>
                </div>

                <div className={styles.formCol}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Brukernavn</span>
                    <input
                      className={styles.input}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="postgres"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Passord</span>
                    <input
                      type="password"
                      className={styles.input}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </label>

                  <button
                    type="button"
                    className={styles.sshToggle}
                    role="switch"
                    aria-checked={useSsh}
                    onClick={() => setUseSsh((v) => !v)}
                  >
                    <span
                      className={`${styles.switch} ${useSsh ? styles.switchOn : ""}`}
                    >
                      <span className={styles.switchKnob} />
                    </span>
                    SSH-tunnel
                  </button>

                  {useSsh && (
                    <>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>SSH host</span>
                        <input
                          className={styles.input}
                          value={sshHost}
                          onChange={(e) => setSshHost(e.target.value)}
                          placeholder="bastion.example.com"
                        />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>SSH bruker</span>
                        <input
                          className={styles.input}
                          value={sshUser}
                          onChange={(e) => setSshUser(e.target.value)}
                          placeholder="ubuntu"
                        />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>SSH port</span>
                        <input
                          className={styles.input}
                          value={sshPort}
                          onChange={(e) => setSshPort(e.target.value)}
                          placeholder="22"
                        />
                      </label>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.formActions}>
                {testStatus === "ok" && (
                  <span className={styles.testOk}>Tilkobling OK</span>
                )}
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => setFormOpen(false)}
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  className={styles.btnDark}
                  disabled={!canConnect || testStatus === "testing"}
                  onClick={handleTest}
                >
                  {testStatus === "testing" ? "Tester…" : "Test tilkobling"}
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={!canConnect}
                  onClick={handleConnect}
                >
                  Koble til
                </button>
              </div>
            </>
          ) : connected && linkState === "linked" ? (
            <div className={styles.dbLinked}>
              <div className={styles.topo}>
                <div className={`${styles.topoNode} ${styles.topoNodeGreen}`}>
                  <div className={styles.topoTitle}>
                    {DB_TYPES.find((t) => t.key === dbType)?.label}
                  </div>
                </div>

                <div className={styles.topoWire}>
                  <button
                    type="button"
                    className={styles.topoBreak}
                    onClick={handleDisconnect}
                    aria-label="Bryt koblingen"
                    title="Bryt koblingen"
                  >
                    <PlusIcon size={13} />
                  </button>
                </div>

                <div className={`${styles.topoNode} ${styles.topoNodePurple}`}>
                  <div className={styles.topoTitle}>Client</div>
                </div>
              </div>
            </div>
          ) : connected ? (
            <>
              <div className={styles.sqlTag}>{tableTag(query)}</div>
              <div className={styles.sqlEditor}>
                <div className={styles.sqlGutter}>
                  {query.split("\n").map((_, i) => (
                    <span key={i}>{i + 1}</span>
                  ))}
                </div>
                <div className={styles.sqlField}>
                  <pre className={styles.sqlHighlight} aria-hidden="true">
                    {highlightSql(query)}
                  </pre>
                  <textarea
                    className={styles.sqlInput}
                    value={query}
                    spellCheck={false}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
              <div className={styles.formActions}>
                <button
                  type="button"
                  className={styles.btnDark}
                  disabled={linkState === "connecting"}
                  onClick={handleLink}
                >
                  {linkState === "connecting" ? (
                    <>
                      <span className={styles.spinner} />
                      Connecting…
                    </>
                  ) : (
                    "Connect"
                  )}
                </button>
              </div>
            </>
          ) : (
            <div className={styles.dbEmpty}>
              <div className={styles.dbEmptyText}>Ingen database tilkoblet</div>
              <button
                type="button"
                className={styles.btnDark}
                onClick={() => setFormOpen(true)}
              >
                Koble til
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
