import { useEffect, useMemo, useState } from "react";
import { fetchDailyUsage, type DailyUsage } from "../../lib/api";
import styles from "./Quota.module.css";

// Månedlig kvote i kr (fastpris per tenant). Midlertidig konstant til
// backend eksponerer tenantens faktiske kvote.
const MONTHLY_QUOTA_NOK = 2000;

const DAYS = 31;

function formatNok(v: number): string {
  return `${Math.round(v).toLocaleString("nb-NO")} kr`;
}

// Første dag i neste måned — når kvoten nullstilles.
function nextResetLabel(): string {
  const d = new Date();
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return next.toLocaleDateString("nb-NO", { day: "numeric", month: "long" });
}

export function Quota() {
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

  const { usedNok, requests } = useMemo(() => {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    let costUsd = 0;
    let req = 0;
    for (const r of rows ?? []) {
      if (!r.day.startsWith(month)) continue;
      costUsd += r.cost_usd;
      req += r.requests;
    }
    return { usedNok: costUsd * usdNok, requests: req };
  }, [rows, usdNok]);

  if (error) return <div className={styles.content}>{error}</div>;
  if (!rows) return null;

  const remaining = Math.max(0, MONTHLY_QUOTA_NOK - usedNok);
  const pct = Math.min(1, usedNok / MONTHLY_QUOTA_NOK);

  return (
    <div className={styles.content}>
      <div className={styles.hero}>
        <div className={styles.heroNumber}>{formatNok(usedNok)}</div>
        <div className={styles.heroLabel}>Brukt denne måneden</div>
      </div>

      <div className={styles.meter}>
        <div className={styles.track}>
          <div
            className={styles.fill}
            style={{ width: `${Math.max(1.5, pct * 100)}%` }}
          />
        </div>
        <div className={styles.scale}>
          <span>0 kr</span>
          <span>{formatNok(MONTHLY_QUOTA_NOK)}</span>
        </div>
      </div>

      <div className={styles.stats}>
        <div className={styles.statMain}>
          <div className={styles.statMainLabel}>Gjenstående kvote</div>
          <div className={styles.statMainValue}>
            {formatNok(remaining)}
            <span className={styles.statMainUnit}>denne måneden</span>
          </div>
        </div>
        <div className={styles.statRows}>
          <div className={styles.statRow}>
            <span className={styles.statKey}>Månedskvote</span>
            <span className={styles.statVal}>{formatNok(MONTHLY_QUOTA_NOK)}</span>
          </div>
          <div className={styles.statRow}>
            <span className={styles.statKey}>Forespørsler</span>
            <span className={styles.statVal}>
              {requests.toLocaleString("nb-NO")}
            </span>
          </div>
          <div className={styles.statRow}>
            <span className={styles.statKey}>Fornyes</span>
            <span className={styles.statVal}>{nextResetLabel()}</span>
          </div>
        </div>
      </div>

      <div className={styles.note}>
        Kvoten fornyes automatisk hver måned. Ta kontakt for å justere planen.
      </div>
    </div>
  );
}
