import { apiFetch } from "../../lib/api/client";

// Kittene er ferdig designede uttrykk: format, tokens, bilder og flate-typer.
// De ligger som JSON i backend (internal/design/kits) og hentes herfra, så
// katalogen modellen ser og det brukeren ser aldri kan komme i utakt. Nye
// uttrykk og nye flate-typer er nye JSON-filer — ingen kode her skal endres.

export interface KitSlot {
  key: string;
  kind: "text" | "markdown" | "list" | "image" | "images" | "widget" | "widgets";
  hint: string;
  required?: boolean;
}

// Blokk i en komposisjon. kind bestemmer hvilken primitiv som rendres, field
// hvilket felt på flaten den viser, class hvilken CSS-klasse den får.
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
  use: string;
  slots: KitSlot[];
  fallback?: string;
  blocks: KitBlock[];
}

export interface Kit {
  name: string;
  type: string;
  label: string;
  description: string;
  format: { ratio: string; width: number };
  tokens: Record<string, string>;
  palette: string[];
  assets: string[];
  layouts: KitLayout[];
}

// Theme er kittet med dokumentets token-overrides lagt oppå.
export interface Theme {
  name: string;
  tokens: Record<string, string>;
  palette: string[];
  assets: string[];
  layouts: KitLayout[];
  format: { ratio: string; width: number };
}

const FALLBACK: Kit = {
  name: "noir",
  type: "deck",
  label: "Noir",
  description: "",
  format: { ratio: "16:9", width: 1920 },
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
  assets: [],
  layouts: [],
};

type KitCatalog = { default: string; kits: Record<string, Kit> };

let cache: KitCatalog | null = null;
let pending: Promise<KitCatalog> | null = null;

// loadKits henter kittene én gang per økt.
export async function loadKits(): Promise<KitCatalog> {
  if (cache) return cache;
  if (!pending)
    pending = apiFetch<KitCatalog>("/design/kits")
      .then((d) => (cache = d))
      .catch(() => ({ default: "noir", kits: { noir: FALLBACK } }));
  return pending;
}

// defaultTheme er uttrykket før kittene er hentet (grafene trenger tokens
// med en gang de mountes).
export function defaultTheme(): Theme {
  return { ...FALLBACK };
}

// resolveTheme legger dokumentets token-overrides oppå kittet. «palette» i
// overrides er en kommaseparert fargeliste.
export function resolveTheme(
  kits: Record<string, Kit>,
  name?: string,
  overrides?: Record<string, string>
): Theme {
  const base = kits[name ?? "noir"] ?? kits.noir ?? FALLBACK;
  const theme: Theme = {
    name: base.name,
    tokens: { ...base.tokens },
    palette: [...base.palette],
    assets: base.assets,
    layouts: base.layouts,
    format: base.format,
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

// resolveAsset: navn fra kittets bildemappe («bg-1») eller full path/URL.
// Slår alltid opp på stammen, så en utskiftet filtype ikke gir tom ramme.
export function resolveAsset(t: Theme, image?: string): string | undefined {
  if (!image) return undefined;
  if (image.startsWith("/") || image.startsWith("http") || image.startsWith("data:"))
    return image;
  const stem = image.replace(/\.[a-z0-9]+$/i, "");
  const hit = t.assets.find(
    (f) => f === image || f.replace(/\.[a-z0-9]+$/i, "") === stem
  );
  return `/themes/${t.name}/${hit ?? image}`;
}

// CSS-variabler for flate-rota (--dk-<token>).
export function themeVars(t: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(t.tokens)) vars[`--dk-${k}`] = v;
  return vars;
}

// layoutOf finner komposisjonen flaten skal rendres med.
export function layoutOf(t: Theme, key?: string): KitLayout | undefined {
  return t.layouts.find((l) => l.key === key) ?? t.layouts[0];
}
