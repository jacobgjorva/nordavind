import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  fetchWidget,
  fetchWidgetData,
  type QueryResult,
  type WidgetSpec,
} from "../../lib/api";
import styles from "./WidgetView.module.css";

// Validert mørk kategori-palett (fra dataviz-skillen). Rekkefølgen er
// CVD-sikkerhetsmekanismen — ikke endre.
const SERIES = [
  "#3987e5", "#008300", "#d55181", "#c98500",
  "#199e70", "#d95926", "#9085e9", "#e66767",
];
const ACCENT = "#3987e5";
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

// Henter x-etiketter og y-verdier (eller de to første kolonnene).
function series(data: QueryResult, c: WidgetSpec) {
  const xi = c.x ? data.columns.indexOf(c.x) : 0;
  const yi = c.y ? data.columns.indexOf(c.y) : 1;
  const labels = data.rows.map((r) => String(r[xi >= 0 ? xi : 0] ?? ""));
  const values = data.rows.map((r) => Number(r[yi >= 0 ? yi : 1]) || 0);
  return { labels, values };
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

// Bygger en jevn (Catmull-Rom → bezier) sti gjennom punktene.
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

// Sparkline: nøkkeltall (siste rad) + trend-graf over hele serien.
function Sparkline({ c, data }: { c: WidgetSpec; data: QueryResult }) {
  const { values } = series(data, c);
  const last = values[values.length - 1] ?? 0;
  const first = values[0] ?? 0;
  const pct = first ? ((last - first) / Math.abs(first)) * 100 : 0;
  const delta =
    values.length > 1
      ? `${pct >= 0 ? "+" : "-"}${fmt(Math.abs(pct))}%`
      : undefined;

  const W = 300;
  const H = 48;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts: [number, number][] = values.map((v, i) => [
    values.length > 1 ? (i / (values.length - 1)) * W : W,
    H - ((v - min) / span) * (H - 6) - 3,
  ]);
  const line = smoothPath(pts);
  const area = `${line} L${W},${H} L0,${H} Z`;
  const gid = `spk-${Math.round(min)}-${Math.round(max)}`;

  return (
    <div className={styles.card}>
      {c.title && <div className={styles.cardLabel}>{c.title}</div>}
      <div className={styles.kpiValue}>
        {fmt(last)}
        {c.unit && <span className={styles.kpiUnit}>{c.unit}</span>}
      </div>
      {delta && <div className={styles.kpiDeltaRow}><Delta text={delta} /></div>}
      <svg className={styles.spark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.28" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={ACCENT} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

// Linjediagram med areal-fyll, resessivt rutenett og ende-markør.
function LineChart({ c, data }: { c: WidgetSpec; data: QueryResult }) {
  const { labels, values } = series(data, c);
  const W = 300;
  const H = 150;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const y = (v: number) => H - ((v - min) / span) * (H - 8) - 4;
  const pts: [number, number][] = values.map((v, i) => [
    values.length > 1 ? (i / (values.length - 1)) * W : W / 2,
    y(v),
  ]);
  const line = smoothPath(pts);
  const area = `${line} L${W},${H} L0,${H} Z`;
  const last = pts[pts.length - 1];
  const grid = [0.25, 0.5, 0.75];

  // Y-akse-verdier (topp, midt, bunn).
  const yTicks = [max, min + span / 2, min];

  return (
    <div className={styles.card}>
      {c.title && <div className={styles.cardTitle}>{c.title}</div>}
      <div className={styles.chartGrid}>
        <div className={styles.yAxis}>
          {yTicks.map((t, i) => (
            <span key={i}>{fmt(t)}</span>
          ))}
        </div>
        <div className={styles.plot}>
          <svg className={styles.svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACCENT} stopOpacity="0.22" />
                <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
              </linearGradient>
            </defs>
            {grid.map((g) => (
              <line key={g} x1="0" x2={W} y1={H * g} y2={H * g}
                stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={area} fill="url(#lineFill)" />
            <path d={line} fill="none" stroke={ACCENT} strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {last && (
            <span
              className={styles.endDot}
              style={{ left: `${(last[0] / W) * 100}%`, top: `${(last[1] / H) * 100}%`, background: ACCENT }}
            />
          )}
        </div>
        <span />
        <div className={styles.axis}>
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>
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
              <div className={styles.bar} style={{ height: `${(v / max) * 100}%`, background: ACCENT }} />
            </div>
            <span className={styles.barLabel}>{labels[i]}</span>
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
function WidgetCard({ c, data }: { c: WidgetSpec; data: QueryResult | null }) {
  if (c.type === "kpi") {
    if (!c.sql) return <Kpi c={c} />;
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
  if (c.type === "sparkline") return <Sparkline c={c} data={data} />;
  if (c.type === "line") return <LineChart c={c} data={data} />;
  if (c.type === "bar") return <BarChart c={c} data={data} />;
  if (c.type === "donut") return <Donut c={c} data={data} />;
  if (c.type === "table") return <Table data={data} />;
  return null;
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
            <WidgetCard c={ready.spec} data={ready.data} />
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
