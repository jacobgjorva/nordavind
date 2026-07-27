import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDocument,
  fetchBoard,
  moveDocument,
  patchSurface,
  streamChat,
  type BoardItem,
} from "../../lib/api";
import { loadKits, type Kit } from "../../tools/design/kit";
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
  const boardRef = useRef<BoardHandle>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    () => fetchBoard(chatId).then(setItems).catch(() => undefined),
    [chatId]
  );

  useEffect(() => {
    load();
    loadKits().then((d) => setKits(d.kits));
  }, [load]);
  useEffect(() => () => abortRef.current?.abort(), []);

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

  const move = (slug: string, pos: { x: number; y: number }) => {
    setItems((prev) => prev.map((it) => (it.slug === slug ? { ...it, ...pos } : it)));
    moveDocument(chatId, slug, pos).catch(load);
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
        busySlug={busySlug}
      />

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
