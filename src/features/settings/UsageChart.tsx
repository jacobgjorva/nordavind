
import { useId, useState } from "react";
import styles from "./Usage.module.css";

const WIDTH = 480;
const HEIGHT = 170;
const PAD = { top: 12, right: 12, bottom: 26, left: 50 };

type ChartSeries = {
  label: string;
  color: string;
  values: number[];
};

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

type UsageChartProps = {
  xLabels: string[];
  series: ChartSeries[];
  formatValue?: (v: number) => string;
  stacked?: boolean;
  inactive?: boolean[];
};

export function UsageChart({
  xLabels,
  series,
  formatValue,
  stacked = false,
  inactive,
}: UsageChartProps) {
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

  const max = stacked
    ? niceMax(Math.max(...stackTops[stackTops.length - 1]))
    : niceMax(Math.max(...series.flatMap((s) => s.values)));
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  function xFor(i: number) {
    return PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  }
  function yFor(v: number) {
    return PAD.top + plotH * (1 - v / max);
  }

  function segmentBounds(i: number) {
    const left = i === 0 ? PAD.left : (xFor(i - 1) + xFor(i)) / 2;
    const right = i === n - 1 ? WIDTH - PAD.right : (xFor(i) + xFor(i + 1)) / 2;
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

  const yTicks = [0, max / 2, max];

  function handleMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
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
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
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
                y={PAD.top}
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
                <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
                <text x={PAD.left - 8} y={y} textAnchor="end" dominantBaseline="middle" className={styles.axisLabel}>
                  {format(t)}
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
            // Maks ~7 etiketter så de ikke overlapper
            const step = Math.ceil(n / 7);
            if (i % step !== 0 && i !== n - 1) return null;
            return (
              <text key={i} x={xFor(i)} y={HEIGHT - 6} textAnchor="middle" className={styles.axisLabel}>
                {label}
              </text>
            );
          })}

          {hover !== null && (
            <line
              x1={xFor(hover)}
              x2={xFor(hover)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--text-faint)"
              strokeWidth={1}
            />
          )}

          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={handleMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>

        {hover !== null && (
          <div className={styles.tooltip} style={{ left: `${(xFor(hover) / WIDTH) * 100}%` }}>
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
