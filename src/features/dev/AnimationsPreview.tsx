import { useState } from "react";
import styles from "./AnimationsPreview.module.css";

// MIDLERTIDIG forhåndsvisningsside for skapelses-animasjonen (pulserende kort).
// Åpnes på /animations. Kan slettes når animasjonen er ferdig.
export function AnimationsPreview() {
  const [n, setN] = useState(0);
  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <span className={styles.tag}>midlertidig · widget-animasjon</span>
        <button className={styles.btn} onClick={() => setN((v) => v + 1)}>
          Kjør på nytt
        </button>
      </div>
      <div className={styles.stage}>
        <div className={styles.frame} key={n}>
          <div className={styles.skeleton}>
            <div className={`${styles.sk} ${styles.skLabel}`} />
            <div className={`${styles.sk} ${styles.skValue}`} />
            <div className={styles.skBars}>
              {[58, 82, 46, 70, 92, 64, 78].map((h, i) => (
                <div
                  key={i}
                  className={`${styles.sk} ${styles.skBar}`}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
