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
          <div className={styles.pulseCard} />
        </div>
      </div>
    </div>
  );
}
