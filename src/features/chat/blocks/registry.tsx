import { Component, type ReactNode } from "react";

// BlockBoundary: en ødelagt blokk (f.eks. tabell-JSON uten rader) skal ALDRI
// velte appen — feilen fanges her og innholdet vises som råtekst i stedet.
class BlockBoundary extends Component<
  { body: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("blokk-rendring feilet:", err);
  }
  render() {
    if (this.state.failed) {
      return <pre>{this.props.body}</pre>;
    }
    return this.props.children;
  }
}

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
    const node = render(body);
    if (node == null) return null;
    return <BlockBoundary body={body}>{node}</BlockBoundary>;
  } catch {
    return null;
  }
}
