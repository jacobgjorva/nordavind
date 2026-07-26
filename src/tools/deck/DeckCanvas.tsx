import { useCallback, useEffect, useState } from "react";
import {
  fetchWidget,
  patchSlide,
  type DeckSlide,
  type WidgetSpec,
} from "../../lib/api";
import { on } from "../../lib/events";
import styles from "./DeckCanvas.module.css";
import { defaultTheme, loadKits, resolveTheme, type DeckKit, type DeckTheme } from "./kit";
import { Slide } from "./Slide";

// DeckCanvas: presentasjonen som et sentrert 16:9-lerret over chatten.
// Brukeren dirigerer med meldinger, og kan dobbeltklikke rett i sliden for å
// rette tekst selv. Begge veier skriver samme patch, så ingenting overskrives.
export function DeckCanvas({
  slug,
  onClose,
}: {
  slug: string;
  onClose: () => void;
}) {
  const [spec, setSpec] = useState<WidgetSpec | null>(null);
  const [kits, setKits] = useState<Record<string, DeckKit> | null>(null);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [presenting, setPresenting] = useState(false);

  const load = useCallback(
    () =>
      fetchWidget(slug)
        .then((w) => {
          setSpec(w.spec ?? {});
          setBusy(false);
        })
        .catch(() => setBusy(false)),
    [slug]
  );

  useEffect(() => {
    load();
    loadKits().then((d) => setKits(d.kits));
  }, [load]);
  useEffect(() => on("deck-updated", (s) => s === slug && load()), [slug, load]);
  useEffect(() => on("deck-working", (s) => s === slug && setBusy(true)), [slug]);

  const slides: DeckSlide[] = spec?.slides ?? [];
  const count = slides.length;
  // Ny slide: hopp til den som nettopp kom til.
  useEffect(() => {
    if (count > 0) setI(count - 1);
  }, [count]);

  const theme: DeckTheme = kits
    ? resolveTheme(kits, spec?.theme, spec?.style)
    : defaultTheme();
  const at = Math.min(i, Math.max(count - 1, 0));
  const current = slides[at];

  // Brukerens egen retting: patch feltet på sliden og oppdater lerretet med
  // en gang (optimistisk — serveren har samme semantikk).
  const edit = (field: string, value: string) => {
    if (!current?.id) return;
    setSpec((prev) =>
      prev
        ? {
            ...prev,
            slides: (prev.slides ?? []).map((s) =>
              s.id === current.id ? { ...s, [field]: value } : s
            ),
          }
        : prev
    );
    patchSlide(slug, { op: "set", id: current.id, [field]: value }).catch(load);
  };

  // Fullskjerm: piltaster blar, Esc lukker.
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresenting(false);
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown")
        setI((n) => Math.min(n + 1, count - 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp")
        setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting, count]);

  if (presenting && current)
    return (
      <div className={styles.present}>
        <button className={styles.presentClose} onClick={() => setPresenting(false)}>
          ✕
        </button>
        <div
          className={styles.presentStage}
          onClick={() => setI((n) => Math.min(n + 1, count - 1))}
        >
          <div className={styles.presentSlide}>
            <Slide key={at} s={current} theme={theme} brand={spec?.title} />
          </div>
        </div>
      </div>
    );

  return (
    <div className={styles.wrap}>
      <div className={`${styles.canvas} ${busy ? styles.busy : ""}`}>
        <div className={styles.tools}>
          {count > 0 && (
            <button className={styles.toolBtn} onClick={() => setPresenting(true)}>
              Presenter
            </button>
          )}
          <button className={styles.toolBtn} onClick={onClose} title="Lukk">
            ✕
          </button>
        </div>
        {count === 0 ? (
          <div className={styles.empty}>
            {spec === null ? "" : "Tomt lerret — beskriv presentasjonen i meldingsfeltet under."}
          </div>
        ) : (
          <>
            <div className={styles.stage}>
              <Slide
                key={`${at}-${count}`}
                s={current}
                theme={theme}
                brand={spec?.title}
                edit={edit}
              />
            </div>
            <div className={styles.nav}>
              <button
                className={styles.navBtn}
                disabled={at <= 0}
                onClick={() => setI((n) => Math.max(n - 1, 0))}
              >
                ←
              </button>
              <span className={styles.count}>
                {at + 1} / {count}
              </span>
              <button
                className={styles.navBtn}
                disabled={at >= count - 1}
                onClick={() => setI((n) => Math.min(n + 1, count - 1))}
              >
                →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
