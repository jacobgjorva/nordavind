// Typet event-buss over window-CustomEvents. Erstatter løse, utypede
// dispatchEvent/addEventListener-kall spredt i komponentene: kanalene og
// deres detalje-typer er samlet ett sted, og on() returnerer opprydning.

interface EventMap {
  "agents-changed": void;
  "chat-deleted": string;
  "widgets-changed": void;
  // Dokumentet er endret av agenten — lerretet henter det på nytt.
  "design-updated": string;
  // Agenten har begynt på en instruks mot lerretet (vis arbeids-puls).
  "design-working": string;
  // Åpne dokumentet på lerretet igjen (fra kortet i chatten).
  "design-open": string;
  // E-post sendt fra compose-kortet — chatten kvitterer med vanlig melding.
  "mail-sent": void;
  // Tilkoblingslisten er endret — paneler bør laste på nytt.
  "connections-changed": void;
  // Send en melding i chatten på brukerens vegne. Med reply satt rendres
  // svaret deterministisk (ingen LLM) — robust for faste flyter.
  "compose-send": { text: string; reply?: string; intent?: "connect" };
  // Slå sidebaren av/på (fra chat-headeren).
  "sidebar-toggle": void;
  // Start ny chat (fra chat-headeren).
  "new-chat": void;
}

export function emit<K extends keyof EventMap>(type: K, detail?: EventMap[K]) {
  window.dispatchEvent(new CustomEvent(`nordavind:${type}`, { detail }));
}

// on abonnerer og returnerer en avmeldingsfunksjon (klar for useEffect-cleanup).
export function on<K extends keyof EventMap>(
  type: K,
  handler: (detail: EventMap[K]) => void
): () => void {
  const listener = (e: Event) => handler((e as CustomEvent).detail);
  window.addEventListener(`nordavind:${type}`, listener);
  return () => window.removeEventListener(`nordavind:${type}`, listener);
}
