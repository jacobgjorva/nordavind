import { apiFetch } from "../../lib/api/client";

// Kittene er ferdig designede temaer: tokens, bilder og slide-komposisjoner.
// De ligger som JSON i backend (internal/deck/kits) og hentes herfra, så
// modellens katalog og det brukeren ser aldri kan komme i utakt. Nye temaer
// og nye slide-typer er nye JSON-filer — ingen kode her skal endres.

export interface KitField {
  key: string;
  kind: "text" | "markdown" | "list" | "image" | "images" | "widget" | "widgets";
  hint: string;
  required?: boolean;
}

// Blokk i en slide-komposisjon. kind bestemmer hvilken primitiv som rendres,
// field hvilket felt på sliden den viser, class hvilken CSS-klasse den får.
export interface KitBlock {
  kind:
    | "group"
    | "bg"
    | "text"
    | "md"
    | "quote"
    | "toc"
    | "brand"
    | "image"
    | "imageAt"
    | "chart"
    | "chartDuo"
    | "kpis"
    | "table";
  field?: string;
  class?: string;
  index?: number;
  prefix?: string;
  fallback?: string;
  children?: KitBlock[];
}

export interface KitLayout {
  key: string;
  label: string;
  use: string;
  fields: KitField[];
  blocks: KitBlock[];
}

export interface DeckKit {
  name: string;
  label: string;
  description: string;
  tokens: Record<string, string>;
  palette: string[];
  images: string[];
  layouts: KitLayout[];
}

// DeckTheme er kittet med deck-spesifikke overrides lagt oppå.
export interface DeckTheme {
  name: string;
  tokens: Record<string, string>;
  palette: string[];
  images: string[];
  layouts: KitLayout[];
}

const FALLBACK: DeckKit = {
  name: "noir",
  label: "Noir",
  description: "",
  tokens: {
    bg: "#000000",
    text: "#ffffff",
    muted: "rgba(255, 255, 255, 0.6)",
    faint: "rgba(255, 255, 255, 0.45)",
    line: "rgba(255, 255, 255, 0.12)",
    grid: "#242424",
    sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  },
  palette: ["#6b8afd", "#e8e97a", "#f2683c"],
  images: [],
  layouts: [],
};

type KitCatalog = { default: string; kits: Record<string, DeckKit> };

let cache: KitCatalog | null = null;
let pending: Promise<KitCatalog> | null = null;

// loadKits henter kittene én gang per økt.
export async function loadKits(): Promise<KitCatalog> {
  if (cache) return cache;
  if (!pending)
    pending = apiFetch<KitCatalog>("/deck/kits")
      .then((d) => (cache = d))
      .catch(() => ({ default: "noir", kits: { noir: FALLBACK } }));
  return pending;
}

// defaultTheme er temaet før kittene er hentet (grafene trenger tokens med
// en gang de mountes).
export function defaultTheme(): DeckTheme {
  return { ...FALLBACK };
}

// resolveTheme legger deck-spesifikke token-overrides oppå kittet. «palette»
// i overrides er en kommaseparert fargeliste.
export function resolveTheme(
  kits: Record<string, DeckKit>,
  name?: string,
  overrides?: Record<string, string>
): DeckTheme {
  const base = kits[name ?? "noir"] ?? kits.noir ?? FALLBACK;
  const theme: DeckTheme = {
    name: base.name,
    tokens: { ...base.tokens },
    palette: [...base.palette],
    images: base.images,
    layouts: base.layouts,
  };
  if (!overrides) return theme;
  const { palette, ...rest } = overrides;
  theme.tokens = { ...theme.tokens, ...rest };
  if (palette)
    theme.palette = palette
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
  return theme;
}

// resolveImage: navn fra temaets bildemappe («bg-1») eller full path/URL.
export function resolveImage(t: DeckTheme, image?: string): string | undefined {
  if (!image) return undefined;
  if (image.startsWith("/") || image.startsWith("http") || image.startsWith("data:"))
    return image;
  // Slå alltid opp mot temaets faktiske filer på stammen («bg-1»): bytter man
  // ut et motiv med en annen filtype, skal gamle decks fortsatt vise bilde.
  const stem = image.replace(/\.[a-z0-9]+$/i, "");
  const hit = t.images.find((f) => f === image || f.replace(/\.[a-z0-9]+$/i, "") === stem);
  return `/themes/${t.name}/${hit ?? image}`;
}

// CSS-variabler for slide-rota (--dk-<token>).
export function themeVars(t: DeckTheme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(t.tokens)) vars[`--dk-${k}`] = v;
  return vars;
}

// layoutOf finner komposisjonen sliden skal rendres med.
export function layoutOf(t: DeckTheme, key?: string): KitLayout | undefined {
  return t.layouts.find((l) => l.key === key) ?? t.layouts[0];
}
