import { useEffect, useState } from "react";
import { loadKits, resolveTheme, type Kit } from "../../tools/design/kit";
import { Surface } from "../../tools/design/Surface";
import styles from "./Gallery.module.css";

// Galleriet er første skjerm på et tomt lerret: brukeren ser uttrykkene og
// peker på ett. Ingen gjetting fra en melding — og miniatyrene er ekte
// flater rendret av samme motor som dokumentet, ikke skjermbilder.

// Én representativ flate per kitt, satt sammen av kittets egen åpningslayout.
function previewSurface(kit: Kit) {
  const layout =
    kit.layouts.find((l) => l.key === "title") ?? kit.layouts[0];
  const fields: Record<string, unknown> = {};
  for (const slot of layout?.slots ?? []) {
    if (slot.kind === "image") fields[slot.key] = kit.assets[0] ?? "";
    else if (slot.key === "title") fields[slot.key] = kit.label;
    else if (slot.key === "content") fields[slot.key] = kit.description;
  }
  return { id: "preview", layout: layout?.key ?? "", fields };
}

export function Gallery({
  onPick,
}: {
  onPick: (kit: string) => void;
}) {
  const [kits, setKits] = useState<Record<string, Kit> | null>(null);
  useEffect(() => {
    loadKits().then((d) => setKits(d.kits));
  }, []);

  const list = Object.values(kits ?? {});
  // Grupper etter dokumenttype, så «presentasjon» og «flyer» står hver for seg.
  const types = [...new Set(list.map((k) => k.type))];

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>Hva skal du lage?</h1>
        <p className={styles.sub}>
          Velg et uttrykk. Du kan bytte når som helst uten å miste innholdet.
        </p>
      </div>
      {types.map((type) => (
        <section key={type} className={styles.section}>
          <div className={styles.sectionLabel}>{typeLabel(type)}</div>
          <div className={styles.grid}>
            {list
              .filter((k) => k.type === type)
              .map((kit) => (
                <button
                  key={kit.name}
                  className={styles.card}
                  onClick={() => onPick(kit.name)}
                >
                  <div className={styles.thumb}>
                    {kits && (
                      <Surface
                        s={previewSurface(kit)}
                        theme={resolveTheme(kits, kit.name)}
                      />
                    )}
                  </div>
                  <div className={styles.cardName}>{kit.label}</div>
                  <div className={styles.cardDesc}>{kit.description}</div>
                </button>
              ))}
          </div>
        </section>
      ))}
      {kits && list.length === 0 && (
        <div className={styles.empty}>Ingen kitt tilgjengelig.</div>
      )}
    </div>
  );
}

function typeLabel(type: string): string {
  switch (type) {
    case "deck":
      return "Presentasjon";
    case "flyer":
      return "Flyer";
    case "campaign":
      return "Kampanje";
    default:
      return type;
  }
}
