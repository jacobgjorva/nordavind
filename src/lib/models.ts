// Nordavind-modellene samlet ett sted: vindskalaen navngir nivåene, med
// beskrivelse og glød-farge. Å legge til en modell = én linje her.
export const DEFAULT_MODEL = "qwen3-235b-a22b-instruct-2507";

interface ModelMeta {
  alias: string; // visningsnavn (vindskala)
  desc: string; // hva modellen er god på
  glow: string; // glød-farge i thinking-animasjonen
}

export const MODELS: Record<string, ModelMeta> = {
  "qwen3-235b-a22b-instruct-2507": { alias: "Bris", desc: "fikser det meste", glow: "#ffffff" },
  "qwen3.5-397b-a17b": { alias: "Storm", desc: "god på avanserte oppgaver", glow: "#c9a8ff" },
  "glm-5.2": { alias: "Orkan", desc: "for de tyngste oppgavene", glow: "#ff9de0" },
  "qwen3.6-35b-a3b": { alias: "Kuling", desc: "god på bilder", glow: "#8fd0ff" },
};

export const modelAlias = (model: string | null) =>
  model ? MODELS[model]?.alias ?? model : "Bris";

export const modelDesc = (model: string | null) =>
  model ? MODELS[model]?.desc ?? "" : "";

export const modelGlow = (model: string | null) =>
  (model && MODELS[model]?.glow) || "#ffffff";
