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
import { Board } from "./Board";
import { Composer } from "../chat/Composer";
import styles from "./DesignWorkspace.module.css";

// DesignWorkspace er designsiden: lerretet er innholdet, ikke et panel oppå
// en samtale. Flatelisten til venstre, verktøylinjen over, instruksfeltet
// under. Alt som bare gir mening for design bor her, og forstyrrer aldri
// vanlig chat.

export function DesignWorkspace({ slug }: { slug: string }) {
  const [spec, setSpec] = useState<WidgetSpec | null>(null);
  const [kits, setKits] = useState<Record<string, Kit> | null>(null);
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

  // Brukerens egen retting: patch feltet og vis det straks. Serveren kjører
  // nøyaktig samme operasjon, så de to kan ikke komme i utakt.
  const edit = (id: string, field: string, value: string) => {
    setSpec((prev) =>
      prev
        ? {
            ...prev,
            surfaces: (prev.surfaces ?? []).map((s) =>
              s.id === id ? { ...s, fields: { ...s.fields, [field]: value } } : s
            ),
          }
        : prev
    );
    patchSurface(slug, { action: "set", id, fields: { [field]: value } }).catch(load);
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
      <Board
        surfaces={surfaces}
        theme={theme}
        brand={spec?.title}
        edit={edit}
        busy={busy}
      />

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
