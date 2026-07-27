import { useEffect, useState } from "react";
import type { WidgetSpec } from "../../lib/api";
import { emit } from "../../lib/events";
import styles from "./DesignCard.module.css";
import { defaultTheme, loadKits, resolveTheme, type Kit } from "./kit";
import { Surface } from "./Surface";

// DesignCard er dokumentet slik det ligger igjen i chatten: første flate som
// miniatyr, og en knapp som åpner lerretet igjen.
export function DesignCard({ c, slug }: { c: WidgetSpec; slug: string }) {
  const [kits, setKits] = useState<Record<string, Kit> | null>(null);
  useEffect(() => {
    loadKits().then((d) => setKits(d.kits));
  }, []);
  const surfaces = c.surfaces ?? [];
  const theme = kits ? resolveTheme(kits, c.kit, c.style) : defaultTheme();
  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <div className={styles.title}>{c.title ?? "Dokument"}</div>
        <button className={styles.open} onClick={() => emit("design-open", slug)}>
          Åpne
        </button>
      </div>
      {surfaces.length === 0 ? (
        <div className={styles.empty}>Ingen flater ennå.</div>
      ) : (
        <div className={styles.thumb}>
          <Surface s={surfaces[0]} theme={theme} brand={c.title} />
        </div>
      )}
      <div className={styles.meta}>
        {surfaces.length} {surfaces.length === 1 ? "flate" : "flater"}
      </div>
    </div>
  );
}
