import { useCallback, useEffect, useState } from "react";
import {
  fetchWidget,
  patchSurface,
  type Surface as SurfaceModel,
  type WidgetSpec,
} from "../../lib/api";
import { on } from "../../lib/events";
import styles from "./DesignCanvas.module.css";
import { defaultTheme, loadKits, resolveTheme, type Kit, type Theme } from "./kit";
import { Surface } from "./Surface";

// DesignCanvas: dokumentet som et sentrert lerret. Brukeren dirigerer med
// meldinger, og kan dobbeltklikke rett i flaten for å rette tekst selv.
// Begge veier går gjennom samme patch i motoren, så ingenting overskrives.
export function DesignCanvas({
  slug,
  onClose,
}: {
  slug: string;
  onClose: () => void;
}) {
  const [spec, setSpec] = useState<WidgetSpec | null>(null);
  const [kits, setKits] = useState<Record<string, Kit> | null>(null);
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
  useEffect(() => on("design-updated", (s) => s === slug && load()), [slug, load]);
  useEffect(() => on("design-working", (s) => s === slug && setBusy(true)), [slug]);

  const surfaces: SurfaceModel[] = spec?.surfaces ?? [];
  const count = surfaces.length;
  // Ny flate: hopp til den som nettopp kom til.
  useEffect(() => {
    if (count > 0) setI(count - 1);
  }, [count]);

  const theme: Theme = kits
    ? resolveTheme(kits, spec?.kit, spec?.style)
    : defaultTheme();
  const at = Math.min(i, Math.max(count - 1, 0));
  const current = surfaces[at];

  // Brukerens egen retting: patch feltet på flaten og oppdater lerretet med
  // en gang (optimistisk — motoren har samme semantikk på serversiden).
  const edit = (field: string, value: string) => {
    if (!current?.id) return;
    setSpec((prev) =>
      prev
        ? {
            ...prev,
            surfaces: (prev.surfaces ?? []).map((s) =>
              s.id === current.id
                ? { ...s, fields: { ...s.fields, [field]: value } }
                : s
            ),
          }
        : prev
    );
    patchSurface(slug, {
      action: "set",
      id: current.id,
      fields: { [field]: value },
    }).catch(load);
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
            <Surface key={at} s={current} theme={theme} brand={spec?.title} />
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
            {spec === null ? "" : "Tomt lerret — beskriv dokumentet i meldingsfeltet under."}
          </div>
        ) : (
          <>
            <div className={styles.stage}>
              <Surface
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
