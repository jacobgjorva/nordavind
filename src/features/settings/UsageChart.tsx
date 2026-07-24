import { useId, useState } from "react";
import styles from "./Usage.module.css";

const WIDTH = 480;
const HEIGHT = 170;
const PAD_TOP = 12;
const PAD_RIGHT = 12;
const PAD_BOTTOM = 26;

type ChartSeries = {
  label: string;
  color: string;
  values: number[];
};

// niceStep runder til nærmeste «pene» steg (1/2/5 · 10^n).
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1) * mag;
}

// yTicksFor gir ~5 pene verdier fra 0 til ≥ max (siste tick dekker alltid maks).
function yTicksFor(max: number): number[] {
  if (max <= 0) return [0, 1];
  const step = niceStep(max / 4);
  const ticks: number[] = [];
  for (let v = 0; v < max; v += step) ticks.push(v);
  ticks.push(ticks.length ? ticks[ticks.length - 1] + step : step);
  return ticks;
}

// axisFormatter velger ÉN enhet for hele aksen ut fra maks-verdien (aldri
// blandet «5 000» og «10 k» på samme akse) og formaterer kompakt norsk.
function axisFormatter(max: number): (v: number) => string {
  const dec = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
  if (max >= 1_000_000_000) return (v) => dec(v / 1_000_000_000) + " mrd";
  if (max >= 1_000_000) return (v) => dec(v / 1_000_000) + " mill";
  if (max >= 10_000) return (v) => dec(v / 1_000) + " k";
  // Én desimal ved behov — avrunding til heltall ga like ticks (0,1,1,2,2)
  // når aksen har steg under 1 (f.eks. maks 2 ordre).
  return (v) => dec(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

type UsageChartProps = {
  xLabels: string[];
  series: ChartSeries[];
  formatValue?: (v: number) => string;
  stacked?: boolean;
  inactive?: boolean[];
  /** Design-bredde i px — sett til containerens bredde for 1:1-skala (default 480). */
  width?: number;
};

export function UsageChart({
  xLabels,
  series,
  formatValue,
  stacked = false,
  inactive,
  width,
}: UsageChartProps) {
  const W = width ?? WIDTH;
  const patternId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const format = formatValue ?? ((v: number) => String(Math.round(v)));

  const n = xLabels.length;

  const stackTops = stacked
    ? series.reduce<number[][]>((acc, s) => {
        const prev = acc[acc.length - 1] ?? new Array(n).fill(0);
        acc.push(s.values.map((v, i) => prev[i] + v));
        return acc;
      }, [])
    : [];
  const stackBottoms = stacked
    ? stackTops.map((_, si) => (si === 0 ? new Array(n).fill(0) : stackTops[si - 1]))
    : [];

  const rawMax = stacked
    ? Math.max(...stackTops[stackTops.length - 1])
    : Math.max(...series.flatMap((s) => s.values));
  const yTicks = yTicksFor(rawMax);
  const max = yTicks[yTicks.length - 1];
  const axisFmt = axisFormatter(max);

  // Venstremarg dimensjoneres etter bredeste akse-etikett, så tallene aldri
  // stikker utenfor kortet (~6.5px per tegn i 11px skrift + luft).
  const padLeft =
    Math.max(...yTicks.map((t) => axisFmt(t).length)) * 6.5 + 16;

  const plotW = W - padLeft - PAD_RIGHT;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  function xFor(i: number) {
    return padLeft + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  }
  function yFor(v: number) {
    return PAD_TOP + plotH * (1 - v / max);
  }

  function segmentBounds(i: number) {
    const left = i === 0 ? padLeft : (xFor(i - 1) + xFor(i)) / 2;
    const right = i === n - 1 ? W - PAD_RIGHT : (xFor(i) + xFor(i + 1)) / 2;
    return { left, right };
  }

  const linePaths = series.map((s, si) => {
    const vals = stacked ? stackTops[si] : s.values;
    return vals.map((v, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(v)}`).join(" ");
  });

  const areaPaths = series.map((_s, si) => {
    if (stacked) {
      const top = stackTops[si];
      const bottom = stackBottoms[si];
      const forward = top.map((v, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(v)}`).join(" ");
      const backward = [...bottom]
        .map((v, i) => `L${xFor(i)},${yFor(v)}`)
        .reverse()
        .join(" ");
      return `${forward} ${backward} Z`;
    }
    return "";
  });

  // X-tetthet etter faktisk bredde (~1 etikett per 110px), alltid første+siste.
  const maxXLabels = Math.max(4, Math.floor(plotW / 110));
  const xStep = Math.max(1, Math.ceil(n / maxXLabels));

  function handleMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let nearestDist = Infinity;
    xLabels.forEach((_, i) => {
      const d = Math.abs(xFor(i) - relX);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    });
    setHover(nearest);
  }

  return (
    <div className={styles.chartBlock}>
      <div className={styles.legend}>
        {inactive?.some(Boolean) && (
          <div className={styles.legendItem}>
            <span className={styles.legendSwatchHatch} />
            Inaktiv
          </div>
        )}
        {series.map((s) => (
          <div key={s.label} className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ background: s.color }} />
            {s.label}
          </div>
        ))}
      </div>

      <div className={styles.chartWrap}>
        <svg
          viewBox={`0 0 ${W} ${HEIGHT}`}
          width="100%"
          className={styles.chartSvg}
        >
          <defs>
            <pattern
              id={patternId}
              width={7}
              height={7}
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <rect width={7} height={7} fill="transparent" />
              <line x1={0} y1={0} x2={0} y2={7} stroke="var(--border-strong)" strokeWidth={3} />
            </pattern>
          </defs>

          {inactive?.map((isInactive, i) => {
            if (!isInactive) return null;
            const { left, right } = segmentBounds(i);
            return (
              <rect
                key={`inactive-${i}`}
                x={left}
                y={PAD_TOP}
                width={right - left}
                height={plotH}
                fill={`url(#${patternId})`}
              />
            );
          })}

          {yTicks.map((t, i) => {
            const y = yFor(t);
            return (
              <g key={i}>
                <line x1={padLeft} x2={W - PAD_RIGHT} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
                <text x={padLeft - 8} y={y} textAnchor="end" dominantBaseline="middle" className={styles.axisLabel}>
                  {axisFmt(t)}
                </text>
              </g>
            );
          })}

          {series.map((s, si) =>
            areaPaths[si] ? (
              <path key={`area-${s.label}`} d={areaPaths[si]} fill={s.color} opacity={stacked ? 0.4 : 0.1} />
            ) : null
          )}

          {series.map((s, si) => (
            <path
              key={s.label}
              d={linePaths[si]}
              fill="none"
              stroke={s.color}
              strokeWidth={1.25}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {xLabels.map((label, i) => {
            if (i % xStep !== 0 && i !== n - 1) return null;
            // Nest siste steg-etikett kan krasje med den aller siste — dropp den.
            if (i !== n - 1 && n - 1 - i < xStep / 2) return null;
            // Kant-etiketter ankres innover så de aldri stikker ut av kortet.
            const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
            const x = i === 0 ? padLeft : i === n - 1 ? W - PAD_RIGHT : xFor(i);
            return (
              <text key={i} x={x} y={HEIGHT - 6} textAnchor={anchor} className={styles.axisLabel}>
                {label}
              </text>
            );
          })}

          {hover !== null && (
            <line
              x1={xFor(hover)}
              x2={xFor(hover)}
              y1={PAD_TOP}
              y2={PAD_TOP + plotH}
              stroke="var(--text-faint)"
              strokeWidth={1}
            />
          )}

          <rect
            x={padLeft}
            y={PAD_TOP}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={handleMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>

        {hover !== null && (
          <div className={styles.tooltip} style={{ left: `${(xFor(hover) / W) * 100}%` }}>
            <div className={styles.tooltipTime}>{xLabels[hover]}</div>
            {series.map((s) => (
              <div key={s.label} className={styles.tooltipRow}>
                <span className={styles.tooltipKey} style={{ background: s.color }} />
                <span className={styles.tooltipValue}>{format(s.values[hover])}</span>
                <span className={styles.tooltipLabel}>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
