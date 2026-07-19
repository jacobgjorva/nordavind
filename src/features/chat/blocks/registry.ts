import type { ReactNode } from "react";

// Register for fenced-blokk-renderere. Hvert verktøy registrerer språkene
// sine (```<lang>``` i chat-markdown) → dette gjør nye verktøy plug-in.
type BlockRenderer = (body: string) => ReactNode;

const registry = new Map<string, BlockRenderer>();

export function registerBlock(lang: string, render: BlockRenderer) {
  registry.set(lang, render);
}

// Rendrer en fenced-blokk hvis noen har registrert språket, ellers null
// (kaller faller tilbake til en vanlig kodeblokk).
export function renderBlock(lang: string, body: string): ReactNode {
  const render = registry.get(lang);
  if (!render) return null;
  try {
    return render(body);
  } catch {
    return null;
  }
}
