import { useEffect, useState } from "react";
import type { WidgetSpec } from "../../lib/api";
import { emit } from "../../lib/events";
import styles from "./DeckCard.module.css";
import { defaultTheme, loadKits, resolveTheme, type DeckKit } from "./kit";
import { Slide } from "./Slide";

// DeckCard er presentasjonen slik den ligger igjen i chatten: første slide som
// miniatyr, og en knapp som åpner lerretet igjen.
export function DeckCard({ c, slug }: { c: WidgetSpec; slug: string }) {
  const [kits, setKits] = useState<Record<string, DeckKit> | null>(null);
  useEffect(() => {
    loadKits().then((d) => setKits(d.kits));
  }, []);
  const slides = c.slides ?? [];
  const theme = kits ? resolveTheme(kits, c.theme, c.style) : defaultTheme();
  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <div className={styles.title}>{c.title ?? "Presentasjon"}</div>
        <button className={styles.open} onClick={() => emit("deck-open", slug)}>
          Åpne
        </button>
      </div>
      {slides.length === 0 ? (
        <div className={styles.empty}>Ingen slides ennå.</div>
      ) : (
        <div className={styles.thumb}>
          <Slide s={slides[0]} theme={theme} brand={c.title} />
        </div>
      )}
      <div className={styles.meta}>
        {slides.length} {slides.length === 1 ? "slide" : "slides"}
      </div>
    </div>
  );
}
