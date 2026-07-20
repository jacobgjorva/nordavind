import type { ApiMessage, ContentPart } from "../../lib/api";

// Rene hjelpefunksjoner for chatten — ingen React, ingen state.

// Hvor mange meldinger som sendes med til modellen. Eldre historikk klippes
// bort så token-kosten per tur ikke vokser kvadratisk med samtalelengden.
export const HISTORY_WINDOW = 12;

// textOf reduserer multimodalt innhold til ren tekst — brukes på historiske
// meldinger så base64-bilder ikke re-sendes hver tur (kun turen de hører til).
export function textOf(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("");
}

// buildHistory bygger meldingslista til modellen: siste HISTORY_WINDOW
// meldinger med bilder strippet fra historikken, pluss den nye turen intakt.
export function buildHistory(
  messages: { role: ApiMessage["role"]; content: string; apiContent?: ApiMessage["content"]; error?: boolean }[],
  current: ApiMessage
): ApiMessage[] {
  return [
    ...messages
      .filter((m) => !m.error)
      .slice(-HISTORY_WINDOW)
      .map((m) => ({ role: m.role, content: textOf(m.apiContent ?? m.content) })),
    current,
  ];
}

export const formatTokens = (n: number) =>
  n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

// Kollisjonsfrie meldings-ID-er.
export const nextId = () => crypto.randomUUID();

// En melding som kun er en widget/mailthread/mailreply-blokk vises i full bredde.
export const isWidgetOnly = (content?: string) =>
  !!content && /^```(widget|mailthread|mailreply)\n[\s\S]*?\n```$/.test(content.trim());

// Tegn på at brukeren vil endre agentens oppsett. Kun da sendes agent-edit-
// verktøystien til backend — vanlige spørsmål i en agent-chat slipper den
// ekstra verktøykonteksten.
const AGENT_EDIT_RE =
  /\b(endre|endra|rediger|oppdater|juster|bytt|sett|pause|stopp|stans|skru|aktiver|deaktiver|slett|hyppig|sjeldne|intervall|tidspunkt|kjør oftere|kjør sjeldnere|frekvens|tokengrense|token-grense|navn)\b/i;

export const wantsAgentEdit = (text: string) => AGENT_EDIT_RE.test(text);

// Tegn på at brukeren vil lagre et vedlagt dokument som bedriftskunnskap.
const SAVE_DOC_RE =
  /\b(lagre|lagr|ta vare på|husk (dette|denne|dokumentet)|legg til|lær(e)? deg|behold)\b/i;

export const wantsSaveDocument = (text: string) => SAVE_DOC_RE.test(text);

// Speiler backendens slugify: brukes når /widget-navnet allerede finnes.
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
