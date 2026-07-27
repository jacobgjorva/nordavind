import type { ApiMessage, ContentPart } from "../../lib/api";

// Rene hjelpefunksjoner for chatten — ingen React, ingen state.

// Hvor mange meldinger som sendes med til modellen. Eldre historikk klippes
// bort så token-kosten per tur ikke vokser kvadratisk med samtalelengden.
export const HISTORY_WINDOW = 12;

// Tegnbudsjett for historikken (~6k tokens). 12 meldinger er ANTALL, ikke
// kost — tolv limte dokumenter ble 45k+ tokens per tur. Budsjettet er taket;
// det som klippes bort dekkes av backendens rullerende samtalesammendrag.
export const HISTORY_CHAR_BUDGET = 24_000;

// Vedlegg i eldre meldinger: dokumentet er som regel bare det aktive temaet
// i de nærmeste turene — utenfor de siste ATTACHMENT_FRESH_MSGS klippes
// vedleggsblokker til et hode, og sammendraget bærer innholdet videre.
export const ATTACHMENT_FRESH_MSGS = 4;
const ATTACHMENT_HEAD_CHARS = 800;

// Klipper [Vedlegg: …]-blokker i en historikk-melding til et kort hode.
// Meldingstekst utenfor vedleggsblokkene røres aldri.
function clipAttachments(content: string): string {
  return content.replace(
    /\[Vedlegg: ([^\]]+)\]\n([\s\S]*?)(?=\n\n\[Vedlegg: |\n\n(?!\[Vedlegg)|$)/g,
    (block, name: string, body: string) =>
      body.length <= ATTACHMENT_HEAD_CHARS
        ? block
        : `[Vedlegg: ${name}]\n${body.slice(0, ATTACHMENT_HEAD_CHARS)}\n[dokument forkortet — innholdet er dekket av samtalesammendraget]`
  );
}

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
// meldinger innenfor HISTORY_CHAR_BUDGET (nyeste vinner), med bilder strippet
// og gamle vedlegg klippet — pluss den nye turen, som ALLTID sendes intakt.
// clipped melder om noe ble kuttet, så backend vet når sammendraget trengs.
export function buildHistory(
  messages: { role: ApiMessage["role"]; content: string; apiContent?: ApiMessage["content"]; error?: boolean }[],
  current: ApiMessage
): { history: ApiMessage[]; clipped: boolean } {
  const source = messages.filter((m) => !m.error);
  const recent = source.slice(-HISTORY_WINDOW);
  let clipped = source.length > recent.length;

  // Bakfra (nyeste først): ordrett til budsjettet er brukt. Den nye turen
  // teller aldri mot budsjettet — vedlegg i aktiv tur skal alltid frem.
  const kept: ApiMessage[] = [];
  let used = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    let content = textOf(m.apiContent ?? m.content);
    if (recent.length - 1 - i >= ATTACHMENT_FRESH_MSGS) {
      const before = content;
      content = clipAttachments(content);
      if (content !== before) clipped = true;
    }
    if (used + content.length > HISTORY_CHAR_BUDGET) {
      clipped = true;
      break; // alt eldre er også utenfor budsjettet
    }
    used += content.length;
    kept.unshift({ role: m.role, content });
  }
  return { history: [...kept, current], clipped };
}

export const formatTokens = (n: number) =>
  n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

// Kollisjonsfrie meldings-ID-er.
export const nextId = () => crypto.randomUUID();

// En melding som kun er en widget- eller mailcompose-blokk vises i full bredde.
export const isWidgetOnly = (content?: string) =>
  !!content && /^```(widget|mailcompose|admin)\n[\s\S]*?\n```$/.test(content.trim());

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
