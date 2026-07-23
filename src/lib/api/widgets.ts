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
