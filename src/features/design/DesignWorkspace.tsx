import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchWidget,
  patchSurface,
  streamChat,
  type Surface as SurfaceModel,
  type WidgetSpec,
} from "../../lib/api";
import {
  defaultTheme,
  loadKits,
  resolveTheme,
  type Kit,
  type Theme,
} from "../../tools/design/kit";
import { Surface } from "../../tools/design/Surface";
import { Composer } from "../chat/Composer";
import styles from "./DesignWorkspace.module.css";

// DesignWorkspace er designsiden: lerretet er innholdet, ikke et panel oppå
// en samtale. Flatelisten til venstre, verktøylinjen over, instruksfeltet
// under. Alt som bare gir mening for design bor her, og forstyrrer aldri
// vanlig chat.

export function DesignWorkspace({ slug }: { slug: string }) {
  const [spec, setSpec] = useState<WidgetSpec | null>(null);
  const [kits, setKits] = useState<Record<string, Kit> | null>(null);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [log, setLog] = useState<{ text: string; done: boolean }[]>([]);
  const [step, setStep] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    () =>
      fetchWidget(slug)
        .then((w) => setSpec(w.spec ?? {}))
        .catch(() => undefined),
    [slug]
  );

  useEffect(() => {
    load();
    loadKits().then((d) => setKits(d.kits));
  }, [load]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const surfaces: SurfaceModel[] = spec?.surfaces ?? [];
  const count = surfaces.length;
  const theme: Theme = kits
    ? resolveTheme(kits, spec?.kit, spec?.style)
    : defaultTheme();
  const index = Math.min(at, Math.max(count - 1, 0));
  const current = surfaces[index];

  // Ny flate: hopp til den som nettopp kom til.
  useEffect(() => {
    if (count > 0) setAt(count - 1);
  }, [count]);

  // Brukerens egen retting: patch feltet og vis det straks. Serveren kjører
  // nøyaktig samme operasjon, så de to kan ikke komme i utakt.
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

  const removeSurface = (id: string) => {
    setSpec((prev) =>
      prev
        ? { ...prev, surfaces: (prev.surfaces ?? []).filter((s) => s.id !== id) }
        : prev
    );
    patchSurface(slug, { action: "remove", id }).catch(load);
  };

  // Instruksen går til modellen med lerretet som kontekst. Ingen chatboble:
  // resultatet er dokumentet, og loggen viser bare hva som ble bedt om.
  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setLog((l) => [...l, { text, done: false }]);
    setBusy(true);
    setStep("Tenker");
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      await streamChat(
        "auto",
        [{ role: "user", content: text }],
        (delta) => {
          if (delta.step) setStep(delta.step);
          if (delta.designUpdated) load();
        },
        abortRef.current.signal,
        { design: slug }
      );
      await load();
      setLog((l) => l.map((e, i) => (i === l.length - 1 ? { ...e, done: true } : e)));
    } catch {
      setLog((l) => l.map((e, i) => (i === l.length - 1 ? { ...e, done: true } : e)));
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.body}>
        <aside className={styles.rail}>
          {surfaces.map((s, i) => (
            <div key={s.id} className={styles.railItem}>
              <button
                className={`${styles.railThumb} ${
                  i === index ? styles.railThumbActive : ""
                }`}
                onClick={() => setAt(i)}
              >
                <Surface s={s} theme={theme} brand={spec?.title} />
              </button>
              <span className={styles.railNum}>{i + 1}</span>
              <button
                className={styles.railDelete}
                onClick={() => removeSurface(s.id)}
                title="Slett flaten"
              >
                ×
              </button>
            </div>
          ))}
          {count === 0 && (
            <div className={styles.railEmpty}>Ingen flater ennå</div>
          )}
        </aside>

        <main className={styles.stageWrap}>
          <div className={`${styles.stage} ${busy ? styles.stageBusy : ""}`}>
            {current ? (
              <Surface
                key={`${index}-${count}`}
                s={current}
                theme={theme}
                brand={spec?.title}
                edit={edit}
              />
            ) : (
              <div className={styles.blank}>
                Beskriv dokumentet i feltet under, så bygger jeg det.
              </div>
            )}
          </div>
          {count > 1 && (
            <div className={styles.nav}>
              <button
                className={styles.navBtn}
                disabled={index <= 0}
                onClick={() => setAt((n) => Math.max(n - 1, 0))}
              >
                ←
              </button>
              <span className={styles.count}>
                {index + 1} / {count}
              </span>
              <button
                className={styles.navBtn}
                disabled={index >= count - 1}
                onClick={() => setAt((n) => Math.min(n + 1, count - 1))}
              >
                →
              </button>
            </div>
          )}
        </main>
      </div>

      <div className={styles.composerWrap}>
        {log.length > 0 && (
          <div className={styles.log}>
            {log.slice(-3).map((e, i) => (
              <span key={i} className={e.done ? styles.logDone : styles.logLive}>
                {e.text}
              </span>
            ))}
          </div>
        )}
        <Composer
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={
            count === 0 ? "Hva skal dokumentet handle om?" : "Hva vil du endre?"
          }
          model={busy ? (step ?? "Jobber") : undefined}
        />
      </div>
    </div>
  );
}
