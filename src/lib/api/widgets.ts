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
}

// Widget slik den ligger i registeret; spec finnes kun ved henting av én.
export interface Widget {
  id: string;
  slug: string;
  title: string;
  spec?: WidgetSpec;
  updated_at: string;
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
  return apiFetch(`/widgets/${slug}/query`);
}
