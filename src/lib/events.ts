// Typet event-buss over window-CustomEvents. Erstatter løse, utypede
// dispatchEvent/addEventListener-kall spredt i komponentene: kanalene og
// deres detalje-typer er samlet ett sted, og on() returnerer opprydning.

interface EventMap {
  "agents-changed": void;
  "chat-deleted": string;
  "mail-sent": { key: string };
  "mail-refine": { key: string; feedback: string };
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
