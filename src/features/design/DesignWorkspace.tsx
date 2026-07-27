import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDocument,
  fetchBoard,
  moveDocument,
  patchDesignMeta,
  patchSurface,
  streamChat,
  type BoardItem,
} from "../../lib/api";
import { loadKits, resolveTheme, type Kit } from "../../tools/design/kit";
import { Surface } from "../../tools/design/Surface";
import { Composer } from "../chat/Composer";
import { Board, type BoardHandle } from "./Board";
import styles from "./DesignWorkspace.module.css";

// Designsiden er et arbeidsområde: mange dokumenter på én uendelig flate.
// Klikk velger et dokument (det snapper til midten), og instruksen gjelder
// det valgte. Står ingenting valgt, lager neste melding et nytt dokument der
// brukeren ser — så varianter kan stå side om side uten å overskrive noe.

export function DesignWorkspace({ chatId }: { chatId: string }) {
  const [items, setItems] = useState<BoardItem[]>([]);
  const [kits, setKits] = useState<Record<string, Kit> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  // Forhåndsvisning: ett dokument i fullskjerm, én flate om gangen.
  const [preview, setPreview] = useState<{ slug: string; at: number } | null>(null);
  const boardRef = useRef<BoardHandle>(null);
  // Posisjoner brukeren nettopp har dratt til, men som serveren ennå ikke har
  // bekreftet. De vinner alltid over hentede data — ellers kan en henting som
  // var underveis svare med den GAMLE posisjonen og få rammen til å blafre
  // tilbake et øyeblikk.
  const pending = useRef<Record<string, { x: number; y: number }>>({});
  const abortRef = useRef<AbortController | null>(null);

  // Henting beholder identiteten til rammer som ikke har endret seg. Uten
  // dette ville hver oppdatering gitt nye objekter for ALLE dokumenter, og
  // memo-en i Board ville rendret hele boardet på nytt.
  const load = useCallback(
    () =>
      fetchBoard(chatId)
        .then((fresh) =>
          setItems((prev) =>
            fresh.map((raw) => {
              const p = pending.current[raw.slug];
              const f = p ? { ...raw, ...p } : raw;
              const old = prev.find((o) => o.slug === f.slug);
              return old && JSON.stringify(old) === JSON.stringify(f) ? old : f;
            })
          )
        )
        .catch(() => undefined),
    [chatId]
  );

  useEffect(() => {
    load();
    loadKits().then((d) => setKits(d.kits));
  }, [load]);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Esc slipper valget: neste melding lager da et nytt canvas i stedet for å
  // endre det du sist jobbet med.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Brukerens egen retting på lerretet. Serveren kjører nøyaktig samme
  // operasjon som modellen ville gjort, så de kan ikke komme i utakt.
  const edit = (slug: string, surfaceId: string, field: string, value: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.slug !== slug
          ? it
          : {
              ...it,
              spec: {
                ...it.spec,
                surfaces: (it.spec.surfaces ?? []).map((s) =>
                  s.id === surfaceId
                    ? { ...s, fields: { ...s.fields, [field]: value } }
                    : s
                ),
              },
            }
      )
    );
    patchSurface(slug, {
      action: "set",
      id: surfaceId,
      fields: { [field]: value },
    }).catch(load);
  };

  const rename = (slug: string, title: string) => {
    setItems((prev) => prev.map((it) => (it.slug === slug ? { ...it, title } : it)));
    patchDesignMeta(slug, { title }).catch(load);
  };

  // Flytting: bare den flyttede rammen får et nytt objekt, resten beholder
  // identiteten sin. Med memo i Board betyr det at ÉN ramme rendres på nytt,
  // ikke hele boardet — og React eier posisjonen, så ingenting spretter
  // tilbake ved neste render.
  const move = (slug: string, pos: { x: number; y: number }) => {
    pending.current[slug] = pos;
    setItems((prev) =>
      prev.map((it) => (it.slug === slug ? { ...it, ...pos } : it))
    );
    moveDocument(chatId, slug, pos)
      .then(() => {
        delete pending.current[slug];
      })
      .catch(() => {
        delete pending.current[slug];
        load();
      });
  };

  // Instruksen gjelder det valgte dokumentet. Er ingenting valgt, opprettes
  // et nytt der brukeren står — det er slik man starter en ny variant.
  async function send() {
    const text = input.trim();
    if (!text || busySlug) return;
    setInput("");

    let slug = selected;
    if (!slug) {
      try {
        const pos = boardRef.current?.center() ?? { x: 0, y: 0 };
        const created = await createDocument(chatId, pos);
        slug = created.slug;
        setSelected(slug);
        await load();
      } catch {
        return;
      }
    }

    setBusySlug(slug);
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
      boardRef.current?.focus(slug);
    } catch {
      // Avbrutt eller feilet: lerretet står som det var.
    } finally {
      setBusySlug(null);
      setStep(null);
    }
  }

  return (
    <div className={styles.page}>
      <Board
        ref={boardRef}
        items={items}
        kits={kits}
        selected={selected}
        onSelect={setSelected}
        onMove={move}
        onEdit={edit}
        onRename={rename}
        onPreview={(slug) => setPreview({ slug, at: 0 })}
        busySlug={busySlug}
      />

      {preview && (
        <Preview
          item={items.find((i) => i.slug === preview.slug)}
          kits={kits}
          at={preview.at}
          onAt={(at) => setPreview((p) => (p ? { ...p, at } : p))}
          onClose={() => setPreview(null)}
        />
      )}

      <div className={styles.composerWrap}>
        <Composer
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={selected ? "Hva vil du endre?" : "Hva skal vi lage?"}
          model={busySlug ? (step ?? "Jobber") : undefined}
          modelHint={
            busySlug ? undefined : selected ? "endrer det valgte" : "lager et nytt"
          }
        />
      </div>
    </div>
  );
}

// Preview viser dokumentet i fullskjerm: piltaster og klikk blar, Esc lukker.
function Preview({
  item,
  kits,
  at,
  onAt,
  onClose,
}: {
  item?: BoardItem;
  kits: Record<string, Kit> | null;
  at: number;
  onAt: (at: number) => void;
  onClose: () => void;
}) {
  const surfaces = item?.spec?.surfaces ?? [];
  const count = surfaces.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === " ") onAt(Math.min(at + 1, count - 1));
      if (e.key === "ArrowLeft") onAt(Math.max(at - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, count, onAt, onClose]);

  if (!item || count === 0) return null;
  const index = Math.min(at, count - 1);
  return (
    <div className={styles.preview}>
      <button className={styles.previewClose} onClick={onClose} aria-label="Lukk">
        ✕
      </button>
      <div
        className={styles.previewStage}
        onClick={() => onAt(Math.min(index + 1, count - 1))}
      >
        <div className={styles.previewSurface}>
          <Surface
            key={index}
            s={surfaces[index]}
            theme={resolveTheme(kits ?? {}, item.spec?.kit, item.spec?.style)}
            brand={item.spec?.title}
          />
        </div>
      </div>
      <div className={styles.previewCount}>
        {index + 1} / {count}
      </div>
    </div>
  );
}
