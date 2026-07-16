
import { UsageChart } from "./UsageChart";
import { TIME_LABELS, TOKEN_USAGE, REQUESTS, COST, SCRAPED_PAGES, INACTIVE } from "../../mock/usage";
import styles from "./Usage.module.css";

function formatTokens(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`;
  return String(Math.round(v));
}

function formatUsd(v: number): string {
  return `$${v.toFixed(2)}`;
}

export function Usage() {
  return (
    <div className={styles.content}>
      <div className={styles.grid}>
        <div className={styles.planCard}>
          <div className={styles.cardTitle}>Plan og grenser</div>

          <div className={styles.stat}>
            <div className={styles.statLabel}>Forbruk denne måneden</div>
            <div className={styles.statValue}>$31.60</div>
          </div>

          <div className={styles.stat}>
            <div className={styles.statLabel}>Månedlig grense</div>
            <div className={styles.statValue}>$100.00</div>
          </div>

          <div className={styles.stat}>
            <div className={styles.statLabel}>Varsle ved</div>
            <div className={styles.statValue}>80% av grense</div>
          </div>

          <button type="button" className={styles.editButton}>
            Endre grense
          </button>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Token-bruk</div>
          <UsageChart
            xLabels={TIME_LABELS}
            stacked
            inactive={INACTIVE}
            series={[
              { label: "Input", color: "#4299E0", values: TOKEN_USAGE.input },
              { label: "Output", color: "#80BAEA", values: TOKEN_USAGE.output },
            ]}
            formatValue={formatTokens}
          />
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Forespørsler</div>
          <UsageChart
            xLabels={TIME_LABELS}
            inactive={INACTIVE}
            series={[{ label: "Forespørsler", color: "#FFAB00", values: REQUESTS }]}
          />
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Kostnad over tid</div>
          <UsageChart
            xLabels={TIME_LABELS}
            series={[{ label: "Kostnad", color: "#CEE5FF", values: COST }]}
            formatValue={formatUsd}
          />
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Sider scrapet</div>
          <UsageChart
            xLabels={TIME_LABELS}
            inactive={INACTIVE}
            series={[{ label: "Sider", color: "#34D499", values: SCRAPED_PAGES }]}
          />
        </div>
      </div>
    </div>
  );
}
