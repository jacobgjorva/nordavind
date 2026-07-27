import { createContext, useContext, useEffect, useState } from "react";
import { runQuery, type QueryResult, type WidgetSpec } from "../../lib/api";
import styles from "./Surface.module.css";
import { defaultTheme, type Theme } from "./kit";

// Grafer, nøkkeltall og tabeller for flater. Hentet uendret fra det gamle
// kittet: dette er primitivene layoutene setter sammen, ikke layout selv.
export const ThemeCtx = createContext<Theme>(defaultTheme());

// Kit «noir»: svart lerret, stor hvit sans-typografi, mono-caps detaljer og
// fargede grafer med verdi-etiketter. Modellen leverer kun innhold/SQL —
// all komposisjon og styling eies av disse komponentene.

// Norsk tallformat med tynt tusenskille.
function fmtN(n: number): string {
  if (!isFinite(n)) return String(n);
  const neg = n < 0;
  const a = Math.abs(n);
  const s = a % 1 === 0 ? a.toFixed(0) : a.toFixed(1);
  const [i, d] = s.split(".");
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (neg ? "-" : "") + ii + (d ? "," + d : "");
}

// «Pent» steg (1/2/5 · 10^n) — aksene lander alltid på runde tall.
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1) * mag;
}

// Én felles enhet for hele grafen (aldri blandet «4 500 000» og «4,5 mill»).
function unitFor(max: number): { div: number; name: string } {
  if (max >= 1_000_000_000) return { div: 1_000_000_000, name: "mrd" };
  if (max >= 1_000_000) return { div: 1_000_000, name: "mill" };
  if (max >= 10_000) return { div: 1_000, name: "k" };
  return { div: 1, name: "" };
}

// Y-skala: runde ticks fra 0 til ≥ maks.
function yScale(maxVal: number): number[] {
  const step = niceStep(maxVal / 4);
  const ticks: number[] = [];
  for (let v = 0; v <= maxVal + step * 0.999; v += step) ticks.push(v);
  return ticks;
}

function shortLabel(s: string): string {
  const date = s.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (date) {
    const mnd = ["jan","feb","mar","apr","mai","jun","jul","aug","sep","okt","nov","des"];
    return `${mnd[Number(date[2]) - 1] ?? date[2]} ${date[1].slice(2)}`;
  }
  return s.length > 14 ? s.slice(0, 13) + "…" : s;
}

// Henter og aggregerer serien for en slide-widget (sum y per x).
function useSeries(spec?: WidgetSpec) {
  const [state, setState] = useState<
    { labels: string[]; values: number[] } | null | "loading"
  >("loading");
  useEffect(() => {
    let alive = true;
    if (!spec?.sql || !spec.connection_id) {
      setState(null);
      return;
    }
    runQuery(spec.connection_id, spec.sql)
      .then((data) => {
        if (!alive) return;
        const xi = Math.max(spec.x ? data.columns.indexOf(spec.x) : 0, 0);
        const yi = Math.max(spec.y ? data.columns.indexOf(spec.y) : 1, 0);
        const sums = new Map<string, number>();
        for (const r of data.rows) {
          const label = String(r[xi] ?? "");
          sums.set(label, (sums.get(label) ?? 0) + (Number(r[yi]) || 0));
        }
        setState({ labels: [...sums.keys()], values: [...sums.values()] });
      })
      .catch(() => alive && setState(null));
    return () => {
      alive = false;
    };
  }, [spec?.sql, spec?.connection_id, spec?.x, spec?.y]);
  return state;
}

function useTable(spec?: WidgetSpec) {
  const [state, setState] = useState<QueryResult | null | "loading">("loading");
  useEffect(() => {
    let alive = true;
    if (!spec?.sql || !spec.connection_id) {
      setState(null);
      return;
    }
    runQuery(spec.connection_id, spec.sql)
      .then((d) => alive && setState(d))
      .catch(() => alive && setState(null));
    return () => {
      alive = false;
    };
  }, [spec?.sql, spec?.connection_id]);
  return state;
}

function Empty({ note }: { note?: string }) {
  return <div className={styles.emptyViz}>{note ?? "Ingen data"}</div>;
}

// Stolpediagram etter referansen: tett grupperte stolper, første fylt lys og
// resten med tynn ramme, liten verdi-etikett inni toppen av hver stolpe,
// små dempede aksetall uten gridlinjer. scale kompenserer for halv bredde.
function KitBar({ spec, scale = 1 }: { spec: WidgetSpec; scale?: number }) {
  const t = useContext(ThemeCtx);
  const s = useSeries(spec);
  if (s === "loading") return <Empty note="Henter …" />;
  if (!s || s.values.length === 0) return <Empty />;
  const k = scale;
  const W = 1000;
  const H = 470;
  const axisSize = 13 * k;
  const valSize = 16 * k;
  const top = 24 * k;
  const bottom = H - 44 * k;
  const left = 30 + 42 * k;
  const right = 985;
  const ticks = yScale(Math.max(...s.values, 1));
  const max = ticks[ticks.length - 1];
  const unit = unitFor(max);
  const n = s.values.length;
  // Tett gruppe sentrert i plottet: smal luft mellom stolpene (~20 % av bredden).
  const plotW = right - left;
  const barW = Math.min((plotW / n) * 0.8, 130 * k);
  const gap = barW * 0.22;
  const groupW = n * barW + (n - 1) * gap;
  const start = left + (plotW - groupW) / 2;
  const val = (v: number) => fmtN(Math.round((v / unit.div) * 10) / 10);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.viz}>
      {ticks.map((v, i) => (
        <text
          key={i}
          x={left - 16}
          y={bottom - ((bottom - top) * v) / max + axisSize * 0.35}
          textAnchor="end"
          className={styles.axis}
          fontSize={axisSize}
        >
          {fmtN(v / unit.div) + (unit.name && i === ticks.length - 1 ? " " + unit.name : "")}
        </text>
      ))}
      {s.values.map((v, i) => {
        const x = start + i * (barW + gap) + barW / 2;
        // Stolpen er aldri lavere enn at etiketten får plass inni.
        const h = Math.max(((bottom - top) * v) / max, valSize * 2.1);
        const filled = i === 0;
        return (
          <g key={i}>
            <rect
              x={x - barW / 2}
              y={bottom - h}
              width={barW}
              height={h}
              fill={filled ? t.tokens.text : "rgba(255, 255, 255, 0.05)"}
              stroke={filled ? "none" : "rgba(255, 255, 255, 0.4)"}
              strokeWidth={1}
            />
            <text
              x={x}
              y={bottom - h + valSize * 1.45}
              textAnchor="middle"
              className={styles.barVal}
              fontSize={valSize}
              fill={filled ? t.tokens.bg : t.tokens.text}
            >
              {val(v)}
            </text>
            <text x={x} y={bottom + axisSize * 1.7} textAnchor="middle" className={styles.axis} fontSize={axisSize}>
              {shortLabel(s.labels[i] ?? "")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Linje: ren hvit strek på mørke gridlinjer.
function KitLine({ spec, scale = 1 }: { spec: WidgetSpec; scale?: number }) {
  const t = useContext(ThemeCtx);
  const axisSize = 15 * scale;
  const s = useSeries(spec);
  if (s === "loading") return <Empty note="Henter …" />;
  if (!s || s.values.length === 0) return <Empty />;
  const W = 1000;
  const H = 470;
  const top = 40;
  const bottom = 400;
  const left = 80;
  const right = 985;
  const ticks = yScale(Math.max(...s.values, 1));
  const max = ticks[ticks.length - 1];
  const unit = unitFor(max);
  const n = s.values.length;
  const pts = s.values.map((v, i) => [
    left + (n === 1 ? (right - left) / 2 : ((right - left) * i) / (n - 1)),
    bottom - ((bottom - top) * v) / max,
  ]);
  const labelStep = Math.max(1, Math.ceil(n / 8));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.viz}>
      {ticks.map((v, i) => {
        const y = bottom - ((bottom - top) * v) / max;
        return (
          <g key={i}>
            <line x1={left} x2={right} y1={y} y2={y} stroke={t.tokens.grid} strokeWidth={1} />
            <text x={left - 10} y={y + 4} textAnchor="end" className={styles.axis} fontSize={axisSize}>
              {fmtN(v / unit.div)}
            </text>
          </g>
        );
      })}
      {unit.name && (
        <text x={left - 10} y={top - 14} textAnchor="end" className={styles.axis} fontSize={axisSize}>
          {unit.name}
        </text>
      )}
      <polyline
        points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="none"
        stroke={t.tokens.text}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {s.labels.map((l, i) =>
        i % labelStep === 0 || i === n - 1 ? (
          <text key={i} x={pts[i][0]} y={bottom + 32} textAnchor="middle" className={styles.axis} fontSize={axisSize}>
            {shortLabel(l)}
          </text>
        ) : null
      )}
    </svg>
  );
}

// Kake/andel: fargede sektorer + callout-liste med prosent i sektor-fargen.
function KitPie({ spec, scale = 1 }: { spec: WidgetSpec; scale?: number }) {
  const t = useContext(ThemeCtx);
  const labSize = 16 * scale;
  const s = useSeries(spec);
  if (s === "loading") return <Empty note="Henter …" />;
  if (!s || s.values.length === 0) return <Empty />;
  const total = s.values.reduce((a, b) => a + b, 0) || 1;
  const cx = 330;
  const cy = 235;
  const r = 190;
  let angle = -Math.PI / 2;
  const arcs = s.values.map((v, i) => {
    const frac = v / total;
    const a0 = angle;
    const a1 = (angle += frac * 2 * Math.PI);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
    const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
    return {
      d: `M${cx},${cy} L${p0[0]},${p0[1]} A${r},${r} 0 ${large} 1 ${p1[0]},${p1[1]} Z`,
      color: t.palette[i % t.palette.length],
      pct: frac * 100,
      label: s.labels[i] ?? "",
    };
  });
  return (
    <svg viewBox="0 0 1000 470" className={styles.viz}>
      {arcs.map((a, i) => (
        <path key={i} d={a.d} fill={a.color} stroke={t.tokens.bg} strokeWidth={2} />
      ))}
      {arcs.slice(0, 8).map((a, i) => (
        <g key={`l${i}`}>
          <text x={620} y={80 + i * 46 * scale} className={styles.pieLabel} fontSize={labSize} fill={a.color}>
            {a.label}
          </text>
          <text x={620} y={80 + i * 46 * scale + 22 * scale} className={styles.axis} fontSize={labSize * 0.9}>
            {fmtN(Math.round(a.pct * 10) / 10)} %
          </text>
        </g>
      ))}
    </svg>
  );
}

// Tabell i regnskaps-stil: mono-caps header, aksentfarge på nøkkelrader.
const KEYROW = /^(total|sum|net|netto|gross|brutto|resultat)/i;

export function KitTable({ spec }: { spec: WidgetSpec }) {
  const t = useContext(ThemeCtx);
  const keyColors = [t.palette[6], t.palette[11], t.palette[5], t.palette[1]].filter(Boolean);
  const d = useTable(spec);
  if (d === "loading") return <Empty note="Henter …" />;
  if (!d || d.rows.length === 0) return <Empty />;
  let keyIdx = 0;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {d.columns.map((c) => (
              <th key={c}>{c.replace(/_/g, " ")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.rows.slice(0, 12).map((r, i) => {
            const isKey = KEYROW.test(String(r[0] ?? ""));
            const color = isKey ? keyColors[keyIdx++ % keyColors.length] : undefined;
            return (
              <tr key={i} style={color ? { color } : undefined} className={isKey ? styles.keyRow : ""}>
                {r.map((cell, j) => {
                  const num = Number(cell);
                  const isNum = cell !== null && cell !== "" && !isNaN(num);
                  return <td key={j}>{isNum ? fmtN(num) : String(cell ?? "")}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Ett nøkkeltall: mono-caps etikett over stort hvitt tall.
export function KitKpi({ spec }: { spec: WidgetSpec }) {
  const d = useTable(spec);
  const label = spec.title ?? "";
  let value = spec.value ?? "";
  if (d && d !== "loading" && d.rows.length > 0) {
    const yi = Math.max(spec.y ? d.columns.indexOf(spec.y) : 0, 0);
    value = fmtN(Number(d.rows[0][yi]) || 0);
  } else if (d === "loading" && spec.sql) {
    value = "…";
  }
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>
        {value}
        {spec.unit && <span className={styles.kpiUnit}> {spec.unit}</span>}
      </div>
    </div>
  );
}

export function Visual({ spec, scale = 1 }: { spec: WidgetSpec; scale?: number }) {
  const t = spec.type ?? "bar";
  if (t === "donut" || t === "pie") return <KitPie spec={spec} scale={scale} />;
  if (t === "line" || t === "sparkline") return <KitLine spec={spec} scale={scale} />;
  if (t === "table") return <KitTable spec={spec} />;
  if (t === "kpi") return <KitKpi spec={spec} />;
  return <KitBar spec={spec} scale={scale} />;
}

// chart-duo: to grafer side ved side, hver med liten tittel under.
export function Duo({ widgets }: { widgets: WidgetSpec[] }) {
  return (
    <div className={styles.duoRow}>
      {widgets.slice(0, 2).map((w, i) => (
        <div key={i} className={styles.duoCell}>
          <div className={styles.duoViz}>
            {/* Halv bredde → ~doble tekststørrelser i viewBoxen. */}
            <Visual spec={w} scale={1.9} />
          </div>
          {w.title && <div className={styles.duoTitle}>{w.title}</div>}
        </div>
      ))}
    </div>
  );
}

