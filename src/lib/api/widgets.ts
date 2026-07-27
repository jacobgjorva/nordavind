import { apiFetch } from "./client";

// WidgetSpec er én visualisering (kpi/text/table/bar/line).
export interface WidgetSpec {
  type?: string;
  title?: string;
  value?: string;
  unit?: string;
  delta?: string;
  content?: string;
  connection_id?: string;
  sql?: string;
  x?: string;
  y?: string;
  // Interaktive kontroller (agent-tolket, virker klient-side på hentede rader).
  search?: string[];
  filters?: { column: string; label?: string }[];
  sort?: { column: string; label?: string; dir?: "asc" | "desc" }[];
  group?: string;
  // type "design": dokument på designlerretet — flater fra et kitt.
  kind?: string;
  kit?: string;
  surfaces?: Surface[];
  /** Token-overrides oppå kittet (bg, text, palette …). */
  style?: Record<string, string>;
}

// Én flate: en slide, en flyer-side, en plakat. Feltene er de kittets layout
// definerer — motoren avviser alt annet.
export interface Surface {
  id: string;
  layout: string;
  fields: SurfaceFields;
}

export interface SurfaceFields {
  title?: string;
  content?: string;
  image?: string;
  images?: string[];
  widget?: WidgetSpec;
  widgets?: WidgetSpec[];
  [key: string]: unknown;
}

// Redigering av én flate. Samme vei inn som modellens patch, så brukerens
// egne rettinger og en chat-instruks aldri kommer i utakt.
export async function patchSurface(
  slug: string,
  op: {
    action?: "set" | "add" | "remove" | "move";
    id?: string;
    after?: string;
    layout?: string;
    fields?: SurfaceFields;
  }
): Promise<void> {
  await apiFetch(`/designs/${slug}/patch`, { method: "POST", body: op });
}

// Setter uttrykk, tittel eller stil på dokumentet (brukerens egne valg).
export async function patchDesignMeta(
  slug: string,
  meta: { kit?: string; title?: string; style?: Record<string, string> }
): Promise<void> {
  await apiFetch(`/designs/${slug}/meta`, { method: "POST", body: meta });
}

// Starter en design-chat: ett tomt dokument og chatten som eier det.
export async function createDesign(
  kit: string,
  title?: string
): Promise<{ chat_id: string; slug: string; kit: string }> {
  return apiFetch("/designs", { method: "POST", body: { kit, title } });
}

// Kjører en lagret SELECT mot en tilkobling (flater henter live data).
export async function runQuery(
  connectionId: string,
  sql: string
): Promise<QueryResult> {
  const d = await apiFetch<QueryResult>("/query", {
    method: "POST",
    body: { connection_id: connectionId, sql },
  });
  return { columns: d.columns ?? [], rows: d.rows ?? [] };
}

// Widget slik den ligger i registeret; spec finnes kun ved henting av én.
export interface Widget {
  id: string;
  slug: string;
  title: string;
  spec?: WidgetSpec;
  /** Utkast (false) vises ikke i menyen før brukeren lagrer eksplisitt. */
  saved?: boolean;
  updated_at: string;
}

// Gjør et widget-utkast til en lagret widget (vises i /-menyen).
export async function saveWidget(slug: string): Promise<void> {
  await apiFetch(`/widgets/${slug}/save`, { method: "POST" });
}

export interface TenantUser {
  id: string;
  email: string;
}

// Kolleger i samme tenant (til delings-velgeren).
export async function fetchTenantUsers(): Promise<TenantUser[]> {
  const data = await apiFetch<{ users?: TenantUser[] }>("/users");
  return data.users ?? [];
}

// Deler widgeten: hver valgt bruker får en kopi i sin meny.
export async function shareWidget(
  slug: string,
  userIds: string[]
): Promise<number> {
  const data = await apiFetch<{ shared: number }>(`/widgets/${slug}/share`, {
    method: "POST",
    body: { user_ids: userIds },
  });
  return data.shared;
}

export interface QueryResult {
  columns: string[];
  rows: (string | number | null)[][];
}

// Lister brukerens widgets (til slash-menyen).
export async function listWidgets(): Promise<Widget[]> {
  return apiFetch("/widgets");
}

// Oppretter en tom widget med gitt navn.
export async function createWidget(title: string): Promise<Widget> {
  return apiFetch("/widgets", { method: "POST", body: { title } });
}

// Henter én widget med spec.
export async function fetchWidget(slug: string): Promise<Widget> {
  return apiFetch(`/widgets/${slug}`);
}

// Kjører widgetens datakilde (read-only).
export async function fetchWidgetData(slug: string): Promise<QueryResult> {
  const d = await apiFetch<QueryResult>(`/widgets/${slug}/query`);
  // Go marshaller tomme slices som null — normaliser så UI-et aldri krasjer.
  return { columns: d.columns ?? [], rows: d.rows ?? [] };
}
