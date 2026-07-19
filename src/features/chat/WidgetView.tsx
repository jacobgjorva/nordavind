import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  fetchWidget,
  fetchWidgetData,
  type QueryResult,
  type WidgetSpec,
} from "../../lib/api";
import styles from "./WidgetView.module.css";

// Standardisert KPI-kort.
function Kpi({ c }: { c: WidgetSpec }) {
  const up = c.delta?.startsWith("+");
  return (
    <div className={styles.kpi}>
      {c.title && <div className={styles.kpiLabel}>{c.title}</div>}
      <div className={styles.kpiValue}>
        {c.value}
        {c.unit && <span className={styles.kpiUnit}>{c.unit}</span>}
      </div>
      {c.delta && (
        <div className={`${styles.kpiDelta} ${up ? styles.up : styles.down}`}>
          {c.delta}
        </div>
      )}
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

// Henter kolonneverdier for x/y (eller de to første kolonnene).
function series(data: QueryResult, c: WidgetSpec) {
  const xi = c.x ? data.columns.indexOf(c.x) : 0;
  const yi = c.y ? data.columns.indexOf(c.y) : 1;
  const labels = data.rows.map((r) => String(r[xi >= 0 ? xi : 0] ?? ""));
  const values = data.rows.map((r) => Number(r[yi >= 0 ? yi : 1]) || 0);
  return { labels, values };
}

function BarChart({ c, data }: { c: WidgetSpec; data: QueryResult }) {
  const { labels, values } = series(data, c);
  const max = Math.max(1, ...values);
  return (
    <div className={styles.chart}>
      <div className={styles.bars}>
        {values.map((v, i) => (
          <div key={i} className={styles.barCol} title={`${labels[i]}: ${v}`}>
            <div
              className={styles.bar}
              style={{ height: `${(v / max) * 100}%` }}
            />
            <span className={styles.barLabel}>{labels[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChart({ c, data }: { c: WidgetSpec; data: QueryResult }) {
  const { labels, values } = series(data, c);
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const W = 100;
  const H = 100;
  const pts = values.map((v, i) => {
    const x = values.length > 1 ? (i / (values.length - 1)) * W : 0;
    const y = H - ((v - min) / (max - min || 1)) * H;
    return `${x},${y}`;
  });
  return (
    <div className={styles.chart}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={styles.line}>
        <polyline points={pts.join(" ")} fill="none" stroke="#6ea8fe" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className={styles.lineLabels}>
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
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
                <td key={j}>{cell === null ? "" : String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// WidgetCard rendrer én ferdig widget fra spec + evt. forhåndslastet data.
// Ingen henting her — data er alltid klar før kortet vises.
function WidgetCard({ c, data }: { c: WidgetSpec; data: QueryResult | null }) {
  if (c.type === "kpi") {
    if (!c.sql) return <Kpi c={c} />;
    const value = String(data?.rows[0]?.[0] ?? "—");
    return <Kpi c={{ ...c, value }} />;
  }
  if (c.type === "text") return <TextBlock c={c} />;
  if (c.type === "table" || c.type === "bar" || c.type === "line") {
    return (
      <div className={styles.card}>
        {c.title && <div className={styles.cardTitle}>{c.title}</div>}
        {!data ? (
          <div className={styles.cardEmpty}>Ingen data.</div>
        ) : c.type === "table" ? (
          <Table data={data} />
        ) : c.type === "line" ? (
          <LineChart c={c} data={data} />
        ) : (
          <BarChart c={c} data={data} />
        )}
      </div>
    );
  }
  return null;
}

// Profesjonell laste-skeleton: konturer i widget-form med et shimmer-sveip.
const SK_BARS = [58, 82, 46, 70, 92, 64, 78];

function WidgetSkeleton() {
  return (
    <div className={styles.skeleton}>
      <div className={`${styles.sk} ${styles.skLabel}`} />
      <div className={`${styles.sk} ${styles.skValue}`} />
      <div className={styles.skBars}>
        {SK_BARS.map((h, i) => (
          <div
            key={i}
            className={`${styles.sk} ${styles.skBar}`}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  );
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
  const wasRevealed = revealed.has(slug);

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

  if (error)
    return (
      <div className={styles.widget}>
        <div className={styles.card}>
          <div className={styles.cardEmpty}>Fant ikke /{slug}.</div>
        </div>
      </div>
    );

  // Innholds-skeleton med shimmer mens widgeten bygges.
  if (!ready)
    return (
      <div className={styles.widget}>
        <WidgetSkeleton />
      </div>
    );

  return (
    <div className={styles.widget}>
      <div className={wasRevealed ? "" : styles.reveal}>
        <WidgetCard c={ready.spec} data={ready.data} />
      </div>
    </div>
  );
}
