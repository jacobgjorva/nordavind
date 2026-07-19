// Rene hjelpefunksjoner for chatten — ingen React, ingen state.

export const formatTokens = (n: number) =>
  n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

// Kollisjonsfrie meldings-ID-er.
export const nextId = () => crypto.randomUUID();

// En melding som kun er en widget/mailthread/mailreply-blokk vises i full bredde.
export const isWidgetOnly = (content?: string) =>
  !!content && /^```(widget|mailthread|mailreply)\n[\s\S]*?\n```$/.test(content.trim());

// Speiler backendens slugify: brukes når /widget-navnet allerede finnes.
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
