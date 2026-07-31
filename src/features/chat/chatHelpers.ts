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

// Markdown krever at ``` står ALENE på sin egen linje. Modellen lukker av og
// til blokken midt i en setning («```Det finnes ingen tall …»), og da svelger
// kodeblokken resten av svaret — og en ```table med prosa i seg slutter å være
// gyldig JSON, så tabellwidgeten faller tilbake til rå kode.
//
// normalizeFences flytter hver fence ut på egen linje, skyver det som lå etter
// den ned som innhold/tekst, og lukker en blokk modellen aldri lukket. Ren
// tekst-inn/tekst-ut: innholdet er uendret, kun linjeskiftene er reparert.
export function normalizeFences(src: string): string {
  if (!src.includes("```")) return src;
  const out: string[] = [];
  let inFence = false;
  for (const raw of src.split("\n")) {
    let line = raw;
    for (;;) {
      const at = line.indexOf("```");
      if (at < 0) {
        out.push(line);
        break;
      }
      if (at > 0) out.push(line.slice(0, at).replace(/\s+$/, ""));
      const rest = line.slice(at + 3);
      if (inFence) {
        out.push("```");
        inFence = false;
        line = rest.replace(/^\s+/, "");
      } else {
        // Åpning: første ord er språket, alt etter det er første innholdslinje.
        const m = rest.match(/^\s*([A-Za-z0-9_+-]*)[ \t]*(.*)$/);
        out.push("```" + (m ? m[1] : ""));
        inFence = true;
        line = m ? m[2] : "";
      }
      if (!line) break;
    }
  }
  if (inFence) out.push("```");
  return out.join("\n");
}

// Lesbarheten skal ikke avhenge av at modellen husker en formatregel — den
// avgjøres her, deterministisk, på teksten som faktisk kom. formatAnswer gjør
// tre ting og aldri mer: bryter lange avsnitt ved setningsgrenser, gir tall
// norsk tusenskille, og uthever størrelser så øyet finner dem. Ingen ord
// legges til, ingen fjernes.

// Et avsnitt får vokse hit før neste setning starter et nytt. Målt mot 720 px
// kolonne / 16 px tekst: ~90 tegn per linje, så 180 er to linjer — kort nok til
// å leses i ett blikk. Grensen brukes GRÅDIG fra venstre, så et brudd som er
// satt aldri flytter seg når mer tekst strømmer inn.
const PARA_SOFT = 180;

// Linjer som eier sitt eget format: kodegjerder, sitat, lister, tabeller,
// overskrifter. De skal aldri brytes eller uthevet.
const STRUCTURED = /^\s*(```|>|[-*+]\s|\d+[.)]\s|\||#{1,6}\s)/;

// Deler et avsnitt i setninger. Punktum inne i tall (86,1) og forkortelser med
// liten forbokstav treffer ikke, fordi neste setning må starte med stor
// bokstav, siffer eller anførsel.
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?:])\s+(?=[A-ZÆØÅ0-9«"])/);
}

// Bryter ett avsnitt i flere når det er blitt for langt å lese i ett jafs.
function splitParagraph(text: string): string[] {
  if (text.length <= PARA_SOFT) return [text];
  const parts = sentences(text);
  if (parts.length < 2) return [text];
  const out: string[] = [];
  let buf = "";
  for (const s of parts) {
    const next = buf ? `${buf} ${s}` : s;
    if (buf && next.length > PARA_SOFT) {
      out.push(buf);
      buf = s;
    } else {
      buf = next;
    }
  }
  if (buf) out.push(buf);
  return out;
}

// Tall som IKKE er størrelser: årstall, datoer, klokkeslett, versjoner.
const YEAR = /^(1[5-9]\d{2}|20\d{2}|21\d{2})$/;

// Grupperer heltall fra fem siffer og opp med hardt mellomrom (86062186 →
// 86 062 186). Hardt, så et beløp aldri brekker over to linjer.
function groupDigits(n: string): string {
  return n.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// Et tall med enhet, tusenskille eller desimaler er en STØRRELSE — det er de
// som skal være lette å finne igjen. Årstall og løpenumre er det ikke.
const MAGNITUDE =
  /(?<![\w*.,-])(\d[\d  .]*\d|\d)(,\d+)?([  ]?(?:%|kr|NOK|MNOK|mill\.?|millioner|milliarder|mrd\.?|prosentpoeng|prosent))?(?![\w*])/g;

// Segmenter som allerede er formatert eller ikke er tall i det hele tatt:
// uthevet tekst, inline-kode, lenker, datoer og klokkeslett. Tallmerkingen
// hopper over dem — ellers havner ** midt inne i et beløp som alt var pent.
const PROTECTED =
  /(\*\*[\s\S]*?\*\*|`[^`]*`|\[[^\]]*\]\([^)]*\)|\d{4}-\d{2}-\d{2}|\d{1,2}[:.]\d{2}(?::\d{2})?)/g;

function markNumbers(text: string): string {
  return text
    .split(PROTECTED)
    .map((seg, i) => (i % 2 === 1 ? seg : markNumbersRaw(seg)))
    .join("");
}

function markNumbersRaw(text: string): string {
  return text.replace(MAGNITUDE, (whole, intPart: string, dec: string, unit: string) => {
    const bare = intPart.replace(/[  .]/g, "");
    if (!/^\d+$/.test(bare)) return whole;
    // Årstall uten enhet og uten desimaler er en dato, ikke en størrelse.
    if (!unit && !dec && YEAR.test(bare)) return whole;
    // Ensifrede tall uten enhet er sjelden noe å lete etter i teksten.
    if (!unit && !dec && bare.length < 4) return whole;
    const grouped = bare.length > 4 ? groupDigits(bare) : bare;
    // Hardt mellomrom mellom tall og enhet: «86 062 186 kr» skal aldri
    // brekke midt i seg selv ved linjeslutt.
    const u = (unit ?? "").replace(/^[  ]/, " ");
    return `**${grouped}${dec ?? ""}${u}**`;
  });
}

// formatAnswer er ren visning: markdown inn, penere markdown ut. Kodeblokker,
// sitater, lister og tabeller røres ikke.
export function formatAnswer(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let inFence = false;
  let para: string[] = [];

  const flush = () => {
    if (para.length === 0) return;
    const text = para.join(" ").replace(/\s+/g, " ").trim();
    para = [];
    for (const p of splitParagraph(text)) out.push(markNumbers(p), "");
  };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      flush();
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      // Kildens blanke linjer er markdown-syntaks: uten dem klistrer et sitat
      // eller en liste seg til avsnittet under og slutter å bli lest som en
      // egen blokk.
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (STRUCTURED.test(line)) {
      flush();
      out.push(markNumbers(line));
      continue;
    }
    para.push(line.trim());
  }
  flush();

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Markert setning: svarets poeng.
//
// «Første setning» var feil regel — den markerte innledningen, ikke poenget.
// Her scores hver setning i svaret i stedet, og den beste vinner. Signalene er
// de samme et menneske leser etter: språket som varsler en konklusjon, tallene
// den hviler på, og posisjonen i svaret.
const MARK_MIN_ANSWER = 220; // kortere svar er sin egen konklusjon
const MARK_MIN = 30;
const MARK_MAX = 170;
const MARK_MIN_SCORE = 3;

// Formuleringer som varsler at det som følger ER poenget.
const CONCLUSION =
  /\b(derfor|det betyr|betyr at|kort sagt|i praksis|hovedgrunnen|konklusjonen|poenget|altså|dermed|slik at|verdt å merke|viktigst|det viktigste|jeg ville|anbefaler|bør du|du bør|har ikke|finnes ikke|ingen)\b/i;

// Ord som gjør en setning til et forbehold eller en formalitet, ikke et poeng.
const HEDGE = /\b(kan du|vil du|skal jeg|si fra|gi meg beskjed|hvis du ønsker)\b/i;

function scoreSentence(s: string, first: boolean, last: boolean): number {
  const text = s.trim();
  if (text.length < MARK_MIN || text.length > MARK_MAX) return -99;
  if (text.endsWith("?")) return -99;
  if (HEDGE.test(text)) return -99;
  // Setninger med lenke- eller sitatsyntaks kan ikke pakkes inn uten å knekke
  // markdownen.
  if (/\[|\]\(/.test(text)) return -99;

  let score = 0;
  // Språket veier tyngst: det er der poenget faktisk merker seg selv. Tall og
  // posisjon er støttesignaler — ellers vinner åpningssetningen hver gang, bare
  // fordi svaret starter med tallene.
  if (CONCLUSION.test(text)) score += 4;
  score += Math.min((text.match(/\*\*/g)?.length ?? 0) / 2, 2) * 1.5;
  if (last) score += 2;
  else if (first) score += 1;
  return score;
}

// markKeySentence pakker svarets viktigste setning i en lenke til #mark, som
// rendreren bytter mot en markering. Markdown-syntaks er brukt med vilje: da
// overlever fet skrift og resten av formateringen inne i markeringen.
//
// Kalles KUN på markdown-stien, aldri på teksten som animeres — markeringen er
// inline og endrer ingen linjehøyde, så den kan dukke opp når animasjonen er
// ferdig uten at noe flytter seg.
export function markKeySentence(formatted: string): string {
  if (formatted.length < MARK_MIN_ANSWER) return formatted;
  const blocks = formatted.split("\n\n");

  let best: { block: number; sentence: string; score: number } | null = null;
  blocks.forEach((block, bi) => {
    if (STRUCTURED.test(block)) return;
    const parts = sentences(block);
    parts.forEach((s, si) => {
      const score = scoreSentence(
        s,
        bi === 0 && si === 0,
        bi === blocks.length - 1 && si === parts.length - 1
      );
      if (score >= MARK_MIN_SCORE && (!best || score > best.score)) {
        best = { block: bi, sentence: s.trim(), score };
      }
    });
  });

  if (!best) return formatted;
  const { block, sentence } = best;
  blocks[block] = blocks[block].replace(sentence, `[${sentence}](#mark)`);
  return blocks.join("\n\n");
}

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
