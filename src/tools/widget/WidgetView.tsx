import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  fetchTenantUsers,
  fetchWidget,
  fetchWidgetData,
  saveWidget,
  shareWidget,
  type QueryResult,
  type TenantUser,
  type WidgetSpec,
} from "../../lib/api";
import { emit } from "../../lib/events";
import { AVATAR_COLORS, avatarColor, initials } from "../../ui/avatar";
import { UsageChart } from "../../features/settings/UsageChart";
import { WidgetControls } from "./WidgetControls";
import { applyControls, autoFilters, hasControls, initialState } from "./controlsLogic";
import styles from "./WidgetView.module.css";

// Samme pastellpalett som avatarene (mail-kortet) — ett visuelt språk.
const SERIES = AVATAR_COLORS.map(([bg]) => bg);
const ACCENT = SERIES[0];
const UP = "#4ec06a";
const DOWN = "#e66767";

// Norsk tallformat: tusenskille med tynt mellomrom, komma-desimal.
function fmt(n: number): string {
  if (!isFinite(n)) return String(n);
  const neg = n < 0;
  const a = Math.abs(n);
  const s = a % 1 === 0 ? a.toFixed(0) : a.toFixed(1);
  const [i, d] = s.split(".");
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (neg ? "-" : "") + ii + (d ? "," + d : "");
}

// shortLabel kutter tidsdelen av datoer og lange etiketter (til x-aksen).
function shortLabel(s: string): string {
  const date = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (date) return date[1];
  return s.length > 14 ? s.slice(0, 13) + "…" : s;
}

// Henter x-etiketter og y-verdier (eller de to første kolonnene). Radene kan
// inneholde ekstra dimensjonskolonner (kunde/status til filtrene) — da finnes
// flere rader per x-verdi, og vi summerer y per x så grafen viser totalen.
function series(data: QueryResult, c: WidgetSpec, domainLabels?: string[]) {
  const xi = Math.max(c.x ? data.columns.indexOf(c.x) : 0, 0);
  const yi = Math.max(c.y ? data.columns.indexOf(c.y) : 1, 0);
  const sums = new Map<string, number>();
  for (const r of data.rows) {
    const label = String(r[xi] ?? "");
    sums.set(label, (sums.get(label) ?? 0) + (Number(r[yi]) || 0));
  }
  // Med domene (ufiltrerte etiketter): behold hele aksen og fyll hull med 0,
  // så et kundefilter ikke krymper tidsrommet til to punkter.
  if (domainLabels) {
    return {
      labels: domainLabels,
      values: domainLabels.map((l) => sums.get(l) ?? 0),
      // Måneder uten rader etter filtrering — skraveres som i Usage-grafene.
      missing: domainLabels.map((l) => !sums.has(l)),
    };
  }
  return { labels: [...sums.keys()], values: [...sums.values()], missing: undefined };
}

// Delta-brikke: ▲/▼ + farge etter fortegn.
function Delta({ text }: { text?: string }) {
  if (!text) return null;
  const t = text.trim();
  const up = t.startsWith("+");
  const down = t.startsWith("-");
  return (
    <span className={styles.delta} style={{ color: up ? UP : down ? DOWN : "var(--text-muted)" }}>
      {up ? "▲" : down ? "▼" : ""} {t.replace(/^[+]/, "")}
    </span>
  );
}

// KPI: ett nøkkeltall (statisk eller fra databasen).
function Kpi({ c }: { c: WidgetSpec }) {
  return (
    <div className={styles.card}>
      {c.title && <div className={styles.cardLabel}>{c.title}</div>}
      <div className={styles.kpiValue}>
        {c.value}
        {c.unit && <span className={styles.kpiUnit}>{c.unit}</span>}
      </div>
      {c.delta && <div className={styles.kpiDeltaRow}><Delta text={c.delta} /></div>}
    </div>
  );
}

// Sparkline: nøkkeltall (siste rad) + trend-graf med akser (som Usage-grafene).
function Sparkline({ c, data, accent = ACCENT }: { c: WidgetSpec; data: QueryResult; accent?: string }) {
  const { labels, values } = series(data, c);
  const last = values[values.length - 1] ?? 0;
  const first = values[0] ?? 0;
  const pct = first ? ((last - first) / Math.abs(first)) * 100 : 0;
  const delta =
    values.length > 1
      ? `${pct >= 0 ? "+" : "-"}${fmt(Math.abs(pct))}%`
      : undefined;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(480);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(320, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  return (
    <div className={styles.card}>
      {c.title && <div className={styles.cardLabel}>{c.title}</div>}
      <div className={styles.kpiValue}>
        {fmt(last)}
        {c.unit && <span className={styles.kpiUnit}>{c.unit}</span>}
      </div>
      {delta && <div className={styles.kpiDeltaRow}><Delta text={delta} /></div>}
      <div ref={wrapRef}>
        <UsageChart
          width={w}
          xLabels={labels.map(shortLabel)}
          series={[{ label: c.y ?? "Verdi", color: accent, values }]}
          formatValue={fmt}
        />
      </div>
    </div>
  );
}

// Linjediagram: samme UI som Usage-grafene (legend, hover-tooltip, crosshair).
// Grafen tegnes i kortets faktiske bredde (1:1-skala), så teksten holder seg
// normal uansett hvor bredt kortet er.
function LineChart({ c, data, domain, accent = ACCENT }: { c: WidgetSpec; data: QueryResult; domain?: QueryResult; accent?: string }) {
  const domainLabels = domain ? series(domain, c).labels : undefined;
  const { labels, values, missing } = series(data, c, domainLabels);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(480);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(320, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return (
    <div className={styles.card}>
      {c.title && <div className={styles.cardTitle}>{c.title}</div>}
      <div ref={wrapRef}>
        <UsageChart
          width={w}
          xLabels={labels.map(shortLabel)}
          series={[{ label: c.y ?? "Verdi", color: accent, values }]}
          formatValue={fmt}
          inactive={missing?.some(Boolean) ? missing : undefined}
        />
      </div>
    </div>
  );
}

// Stolpediagram: én serie (sekvensiell blå), avrundede topper, verdi ved hover.
function BarChart({ c, data }: { c: WidgetSpec; data: QueryResult }) {
  const { labels, values } = series(data, c);
  const max = Math.max(1, ...values);
  return (
    <div className={styles.card}>
      {c.title && <div className={styles.cardTitle}>{c.title}</div>}
      <div className={styles.bars}>
        {values.map((v, i) => (
          <div key={i} className={styles.barCol} title={`${labels[i]}: ${fmt(v)}`}>
            <span className={styles.barVal}>{fmt(v)}</span>
            <div className={styles.barTrack}>
              <div
                className={styles.bar}
                style={{ height: `${(v / max) * 100}%`, background: SERIES[i % SERIES.length] }}
              />
            </div>
            <span className={styles.barLabel}>{shortLabel(labels[i] ?? "")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Donut: andel/fordeling med kategori-farger, total i midten, legende under.
function Donut({ c, data }: { c: WidgetSpec; data: QueryResult }) {
  const { labels, values } = series(data, c);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const R = 42;
  const C = 2 * Math.PI * R;
  const GAP = values.length > 1 ? 2 : 0; // 2px flate-mellomrom mellom segmenter
  let offset = 0;
  const arcs = values.map((v, i) => {
    const frac = v / total;
    const full = frac * C;
    const dash = Math.max(0, full - GAP);
    const seg = { color: SERIES[i % SERIES.length], dash, gap: C - dash, off: offset };
    offset -= full;
    return seg;
  });
  return (
    <div className={styles.card}>
      {c.title && <div className={styles.cardTitle}>{c.title}</div>}
      <div className={styles.donutRow}>
        <div className={styles.donutWrap}>
          <svg viewBox="0 0 100 100" className={styles.donut}>
            {arcs.map((a, i) => (
              <circle key={i} cx="50" cy="50" r={R} fill="none"
                stroke={a.color} strokeWidth="12"
                strokeDasharray={`${a.dash} ${a.gap}`} strokeDashoffset={a.off}
                transform="rotate(-90 50 50)" />
            ))}
            <text x="50" y="47" className={styles.donutTotal} textAnchor="middle">{fmt(total)}</text>
            <text x="50" y="60" className={styles.donutCap} textAnchor="middle">totalt</text>
          </svg>
        </div>
        <div className={styles.legend}>
          {labels.map((l, i) => (
            <div key={i} className={styles.legendRow}>
              <span className={styles.legendDot} style={{ background: SERIES[i % SERIES.length] }} />
              <span className={styles.legendLabel}>{l}</span>
              <span className={styles.legendVal}>{fmt(values[i])}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Table({ data }: { data: QueryResult }) {
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {data.columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.slice(0, 50).map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j}>
                  {cell === null
                    ? ""
                    : typeof cell === "number"
                      ? fmt(cell)
                      : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TextBlock({ c }: { c: WidgetSpec }) {
  return (
    <div className={styles.textBlock}>
      <Markdown remarkPlugins={[remarkGfm]}>{c.content ?? ""}</Markdown>
    </div>
  );
}

// WidgetCard rendrer én ferdig widget fra spec + evt. forhåndslastet data.
// Ingen henting her — data er alltid klar før kortet vises.
function WidgetCard({ c, data, domain, accent }: { c: WidgetSpec; data: QueryResult | null; domain?: QueryResult; accent?: string }) {
  if (c.type === "kpi") {
    if (!c.sql) {
      // Statisk verdi fra modellen kan komme uformatert ("1062438.95") —
      // tallaktige verdier får norsk tusenskille som SQL-varianten.
      const n = Number(String(c.value ?? "").replace(/\s/g, "").replace(",", "."));
      return <Kpi c={isFinite(n) && String(c.value ?? "").trim() !== "" ? { ...c, value: fmt(n) } : c} />;
    }
    return <Kpi c={{ ...c, value: fmt(Number(data?.rows[0]?.[0] ?? 0)) }} />;
  }
  if (c.type === "text") return <TextBlock c={c} />;
  if (!data || data.rows.length === 0)
    return (
      <div className={styles.card}>
        {c.title && <div className={styles.cardTitle}>{c.title}</div>}
        <div className={styles.cardEmpty}>Ingen data.</div>
      </div>
    );
  if (c.type === "sparkline") return <Sparkline c={c} data={data} accent={accent} />;
  if (c.type === "line") return <LineChart c={c} data={data} domain={domain} accent={accent} />;
  if (c.type === "bar") return <BarChart c={c} data={data} />;
  if (c.type === "donut") return <Donut c={c} data={data} />;
  if (c.type === "table") return <Table data={data} />;
  return null;
}

// InteractiveCard legger søk/filter/sort/gruppe over kortet når specen har
// kontroller. Kontrollene virker klient-side på de hentede radene — WidgetCard
// (visualen) er urørt og får bare de avledede radene.
function InteractiveCard({ c, data, accent }: { c: WidgetSpec; data: QueryResult | null; accent?: string }) {
  const [state, setState] = useState(() => initialState(c));
  const enabled =
    !!data &&
    data.rows.length > 0 &&
    (hasControls(c) || autoFilters(data, c).length > 0);
  const view = useMemo(
    () => (enabled && data ? applyControls(data, c, state) : data),
    [enabled, data, c, state]
  );
  if (!enabled || !data) return <WidgetCard c={c} data={data} accent={accent} />;
  return (
    <div className={styles.interactive}>
      <WidgetControls spec={c} data={data} state={state} onChange={setState} />
      <WidgetCard c={c} data={view} domain={data} accent={accent} />
    </div>
  );
}

// ShareButton: velg kolleger og del — mottakerne får widgeten i sin meny.
function ShareButton({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<TenantUser[] | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  async function toggleOpen() {
    if (!open && users === null) {
      setUsers(await fetchTenantUsers().catch(() => []));
    }
    setOpen((o) => !o);
  }

  async function doShare() {
    const ids = Object.keys(picked).filter((id) => picked[id]);
    if (ids.length === 0 || state === "busy") return;
    setState("busy");
    try {
      await shareWidget(slug, ids);
      setState("done");
      setTimeout(() => {
        setState("idle");
        setOpen(false);
        setPicked({});
      }, 1200);
    } catch {
      setState("idle");
    }
  }

  return (
    <span className={styles.shareWrap}>
      <button className={styles.shareBtn} onClick={toggleOpen}>
        Del
      </button>
      {open && (
        <span className={styles.sharePop}>
          {users === null ? (
            <span className={styles.shareEmpty}>Henter …</span>
          ) : users.length === 0 ? (
            <span className={styles.shareEmpty}>Ingen andre brukere</span>
          ) : (
            <>
              {users.map((u) => (
                <label key={u.id} className={styles.shareRow}>
                  <input
                    type="checkbox"
                    checked={!!picked[u.id]}
                    onChange={(e) =>
                      setPicked((p) => ({ ...p, [u.id]: e.target.checked }))
                    }
                  />
                  <span
                    className={styles.shareAvatar}
                    style={{
                      background: avatarColor(u.email)[0],
                      color: avatarColor(u.email)[1],
                    }}
                  >
                    {initials("", u.email)}
                  </span>
                  {u.email}
                </label>
              ))}
              <button
                className={styles.saveBtn}
                onClick={doShare}
                disabled={state === "busy"}
              >
                {state === "busy"
                  ? "Deler …"
                  : state === "done"
                    ? "Delt ✓"
                    : "Del med valgte"}
              </button>
            </>
          )}
        </span>
      )}
    </span>
  );
}

// Laste-skeleton: tomt kort med et glans-sveip.
function WidgetSkeleton() {
  return <div className={styles.skeleton} />;
}

// Widgets som allerede er avslørt i denne økta — recall/reload skal ikke
// spille skapelses-animasjonen på nytt.
const revealed = new Set<string>();

// WidgetView henter widgetens spec fra /<slug> og rendrer den inline. Mens
// spec + data er klar. Kortet vises aldri halvferdig — animasjonen står til alt
// er på plass. Minst MIN_FORM_MS så bloomet rekker å føles.
const MIN_FORM_MS = 900;
const POLL_MS = 400;
const MAX_WAIT_MS = 30000;

export function WidgetView({ slug }: { slug: string }) {
  // ready = { spec, data } først når ALT er lastet; da felles kortet inn.
  const [ready, setReady] = useState<{ spec: WidgetSpec; data: QueryResult | null } | null>(null);
  // Utkast-status: viser Lagre-knapp til brukeren eksplisitt lagrer widgeten.
  const [saved, setSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  // Fang ved mount: recall/reload (allerede avslørt) hopper over animasjonen,
  // men første bygging animerer. Live-oppslag ville blitt sant for tidlig.
  const wasRevealed = useRef(revealed.has(slug)).current;

  // Myk høyde-overgang fra skeleton til ferdig kort (ikke hopp).
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const prevH = useRef(0);

  // Husk skeleton-høyden mens vi laster.
  useLayoutEffect(() => {
    if (!ready && !error && wrapRef.current) {
      prevH.current = wrapRef.current.offsetHeight;
    }
  });

  // revealing = skeleton-overlegget krymper + krysstoner mens kortet dukker opp
  // under det, så selve boksen resizer synlig (ikke bare en usynlig container).
  const [revealing, setRevealing] = useState(false);

  const REVEAL_MS = 550;

  // Ved avsløring: animer høyden fra skeleton til kortet med Web Animations
  // API (uavhengig av transition/reflow-timing → pålitelig i React).
  useLayoutEffect(() => {
    if ((!ready && !error) || wasRevealed) return;
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    const from = prevH.current;
    const to = inner.offsetHeight;
    if (!from || from === to || typeof wrap.animate !== "function") return;
    wrap.style.overflow = "hidden";
    setRevealing(true);
    const anim = wrap.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: REVEAL_MS, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" }
    );
    const done = () => {
      wrap.style.overflow = "";
      setRevealing(false);
    };
    anim.addEventListener("finish", done);
    anim.addEventListener("cancel", done);
    return () => anim.cancel();
  }, [ready, error, wasRevealed]);

  useEffect(() => {
    let alive = true;
    const started = performance.now();
    const animate = !revealed.has(slug);

    // Poll til spec har en type (modellen kan fortsatt bygge), hent så data.
    async function load() {
      while (alive) {
        try {
          const w = await fetchWidget(slug);
          const spec = w.spec ?? {};
          if (spec.type) {
            // Data-widget: hent resultatet før avsløring.
            let data: QueryResult | null = null;
            if (spec.sql) {
              try {
                data = await fetchWidgetData(slug);
              } catch {
                data = null;
              }
            }
            if (!alive) return;
            const wait = animate
              ? Math.max(0, MIN_FORM_MS - (performance.now() - started))
              : 0;
            setTimeout(() => {
              if (!alive) return;
              revealed.add(slug);
              setSaved(w.saved !== false);
              setReady({ spec, data });
            }, wait);
            return;
          }
        } catch {
          if (!alive) return;
          setError(true);
          return;
        }
        if (performance.now() - started > MAX_WAIT_MS) {
          if (alive) setError(true);
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [slug]);

  // Én container hele veien, så høyden kan animeres mykt ved avsløring.
  return (
    <div ref={wrapRef} className={styles.widget} style={{ position: "relative" }}>
      <div ref={innerRef}>
        {error ? (
          <div className={styles.card}>
            <div className={styles.cardEmpty}>Fant ikke /{slug}.</div>
          </div>
        ) : !ready ? (
          <WidgetSkeleton />
        ) : (
          <div className={wasRevealed ? "" : styles.reveal}>
            <InteractiveCard c={ready.spec} data={ready.data} accent={avatarColor(slug)[0]} />
            <div className={styles.saveBar}>
              <span className={styles.saveHint}>{saved ? `/${slug}` : ""}</span>
              <span className={styles.barActions}>
                <ShareButton slug={slug} />
                {!saved && (
                  <button
                    className={styles.saveBtn}
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true);
                      try {
                        await saveWidget(slug);
                        setSaved(true);
                        emit("widgets-changed");
                      } catch {
                        /* beholder knappen */
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    {saving ? "Lagrer …" : "Lagre"}
                  </button>
                )}
              </span>
            </div>
          </div>
        )}
      </div>
      {/* Skeleton-overlegg som krymper med boksen og toner ut. */}
      {revealing && (
        <div
          className={styles.skeletonOverlay}
          style={{ animationDuration: `${REVEAL_MS}ms` }}
        />
      )}
    </div>
  );
}
