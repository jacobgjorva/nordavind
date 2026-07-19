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

// Data-drevet visning (kpi/table/bar/line med SQL): henter query-resultatet.
function DataComponent({ slug, c }: { slug: string; c: WidgetSpec }) {
  const [data, setData] = useState<QueryResult | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchWidgetData(slug)
      .then(setData)
      .catch(() => setError(true));
  }, [slug, c.sql, c.connection_id]);

  // KPI fra database: første celle blir tallet.
  if (c.type === "kpi") {
    const value =
      error || !data
        ? error
          ? "—"
          : "…"
        : String(data.rows[0]?.[0] ?? "—");
    return <Kpi c={{ ...c, value }} />;
  }

  return (
    <div className={styles.card}>
      {c.title && <div className={styles.cardTitle}>{c.title}</div>}
      {error ? (
        <div className={styles.cardEmpty}>Kunne ikke hente data.</div>
      ) : !data ? (
        <div className={styles.cardEmpty}>Laster …</div>
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

// Rendrer én widget-spec (uten henting).
export function WidgetBody({ slug, c }: { slug: string; c: WidgetSpec }) {
  if (c.type === "kpi")
    return c.sql ? <DataComponent slug={slug} c={c} /> : <Kpi c={c} />;
  if (c.type === "text") return <TextBlock c={c} />;
  if (c.type === "table" || c.type === "bar" || c.type === "line")
    return <DataComponent slug={slug} c={c} />;
  return null;
}

// WindForming er skapelses-animasjonen: diffus hvit glød som driver som vind
// og gradvis former widgeten før kortet felles inn.
function WindForming({ dissipating }: { dissipating?: boolean }) {
  return (
    <div className={`${styles.forming} ${dissipating ? styles.dissipate : ""}`}>
      <div className={`${styles.glow} ${styles.glow1}`} />
      <div className={`${styles.glow} ${styles.glow2}`} />
      <div className={`${styles.glow} ${styles.glow3}`} />
      <div className={`${styles.streak} ${styles.streak1}`} />
      <div className={`${styles.streak} ${styles.streak2}`} />
      <div className={`${styles.streak} ${styles.streak3}`} />
      <div className={styles.outline} />
    </div>
  );
}

// Minimumstid gløden får forme seg, så avsløringen føles fortjent.
const FORM_MS = 1500;

// WidgetView henter widgetens spec fra /<slug> og rendrer den inline. Mens
// spec hentes (og i minst FORM_MS) spilles vind-animasjonen.
export function WidgetView({ slug }: { slug: string }) {
  const [spec, setSpec] = useState<WidgetSpec | null>(null);
  const [error, setError] = useState(false);
  const [forming, setForming] = useState(true);

  useEffect(() => {
    let alive = true;
    const started = performance.now();
    fetchWidget(slug)
      .then((w) => {
        if (!alive) return;
        setSpec(w.spec ?? {});
        // Hold gløden til minst FORM_MS har gått.
        const wait = Math.max(0, FORM_MS - (performance.now() - started));
        setTimeout(() => alive && setForming(false), wait);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [slug]);

  // Spilles mens widgeten «formes» av vinden.
  if (forming && !error) {
    return (
      <div className={styles.widget}>
        <WindForming />
      </div>
    );
  }

  if (error)
    return (
      <div className={styles.widget}>
        <div className={styles.card}>
          <div className={styles.cardEmpty}>Fant ikke /{slug}.</div>
        </div>
      </div>
    );
  if (!spec)
    return (
      <div className={styles.widget}>
        <div className={styles.card}>
          <div className={styles.cardEmpty}>Laster …</div>
        </div>
      </div>
    );
  if (!spec.type)
    return (
      <div className={styles.widget}>
        <div className={styles.card}>
          <div className={styles.cardEmpty}>/{slug} er tom.</div>
        </div>
      </div>
    );
  return (
    <div className={styles.widget}>
      <div className={styles.reveal}>
        <WidgetBody slug={slug} c={spec} />
      </div>
    </div>
  );
}
