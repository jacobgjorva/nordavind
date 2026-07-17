import { useEffect, useMemo, useState } from "react";
import { UsageChart } from "./UsageChart";
import { fetchDailyUsage, type DailyUsage } from "../../lib/api";
import styles from "./Usage.module.css";

const DAYS = 14;

// Midlertidig: tjenesteavgift som påslag på EUrouter-kostnaden.
const SERVICE_FEE_RATE = 0.2;


function formatTokens(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`;
  return String(Math.round(v));
}

function formatUsd(v: number): string {
  return `$${v.toFixed(v > 0 && v < 0.1 ? 4 : 2)}`;
}

function formatNok(v: number): string {
  return `${v.toFixed(v > 0 && v < 0.01 ? 4 : 2)} kr`;
}

// Fyller siste N dager slik at grafene får sammenhengende akse.
function lastDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(d);
    day.setDate(d.getDate() - i);
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

export function Usage() {
  const [rows, setRows] = useState<DailyUsage[] | null>(null);
  const [usdNok, setUsdNok] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDailyUsage(DAYS, "tenant")
      .then((res) => {
        setRows(res.usage);
        setUsdNok(res.usdNok);
      })
      .catch(() => setError("Kunne ikke hente forbruksdata."));
  }, []);

  const data = useMemo(() => {
    const days = lastDays(DAYS);
    const byDay = new Map(
      days.map((d) => [d, { in: 0, out: 0, req: 0, cost: 0, search: 0 }])
    );
    for (const r of rows ?? []) {
      const d = byDay.get(r.day);
      if (!d) continue;
      d.in += r.prompt_tokens;
      d.out += r.completion_tokens;
      d.req += r.requests;
      d.cost += r.cost_usd;
      d.search += r.searches;
    }
    const vals = [...byDay.values()];
    let acc = 0;
    return {
      labels: days.map((d) => d.slice(5)),
      input: vals.map((v) => v.in),
      output: vals.map((v) => v.out),
      requests: vals.map((v) => v.req),
      cumulativeCost: vals.map((v) => (acc += v.cost)),
      searches: vals.map((v) => v.search),
      inactive: vals.map((v) => v.req === 0),
      totalCost: vals.reduce((s, v) => s + v.cost, 0),
      totalRequests: vals.reduce((s, v) => s + v.req, 0),
    };
  }, [rows]);

  if (error) return <div className={styles.content}>{error}</div>;
  if (!rows) return null;

  return (
    <div className={styles.content}>
      <div className={styles.grid}>
        <div className={styles.planCard}>
          <div className={styles.cardTitle}>Siste {DAYS} dager</div>

          <div className={styles.stat}>
            <div className={styles.statLabel}>Kostnad</div>
            <div className={styles.statValue}>
              {formatUsd(data.totalCost)}
              {usdNok > 0 && ` (${formatNok(data.totalCost * usdNok)})`}
            </div>
          </div>

          <div className={styles.stat}>
            <div className={styles.statLabel}>Tjenesteavgift</div>
            <div className={styles.statValue}>
              {formatNok(data.totalCost * SERVICE_FEE_RATE * usdNok)}
            </div>
          </div>

          <div className={styles.stat}>
            <div className={styles.statLabel}>Totalt</div>
            <div className={styles.statValue}>
              {formatNok(data.totalCost * (1 + SERVICE_FEE_RATE) * usdNok)}
            </div>
          </div>

          <div className={styles.stat}>
            <div className={styles.statLabel}>Forespørsler</div>
            <div className={styles.statValue}>{data.totalRequests}</div>
          </div>

          <div className={styles.stat}>
            <div className={styles.statLabel}>Snitt per forespørsel</div>
            <div className={styles.statValue}>
              {data.totalRequests
                ? `${formatUsd(data.totalCost / data.totalRequests)}${
                    usdNok > 0
                      ? ` (${formatNok((data.totalCost / data.totalRequests) * usdNok)})`
                      : ""
                  }`
                : "—"}
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Token-bruk</div>
          <UsageChart
            xLabels={data.labels}
            inactive={data.inactive}
            stacked
            series={[
              { label: "Input", color: "#4299E0", values: data.input },
              { label: "Output", color: "#80BAEA", values: data.output },
            ]}
            formatValue={formatTokens}
          />
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Forespørsler</div>
          <UsageChart
            xLabels={data.labels}
            inactive={data.inactive}
            series={[
              { label: "Forespørsler", color: "#FFAB00", values: data.requests },
            ]}
          />
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Kostnad akkumulert</div>
          <UsageChart
            xLabels={data.labels}
            series={[
              { label: "Kostnad", color: "#CEE5FF", values: data.cumulativeCost },
            ]}
            formatValue={formatUsd}
          />
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Websøk</div>
          <UsageChart
            xLabels={data.labels}
            inactive={data.inactive}
            series={[{ label: "Søk", color: "#34D499", values: data.searches }]}
          />
        </div>
      </div>
    </div>
  );
}
