import { BASE_URL, authHeaders } from "./client";

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
  const res = await fetch(`${BASE_URL}/widgets`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Oppretter en tom widget med gitt navn.
export async function createWidget(title: string): Promise<Widget> {
  const res = await fetch(`${BASE_URL}/widgets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Henter én widget med spec.
export async function fetchWidget(slug: string): Promise<Widget> {
  const res = await fetch(`${BASE_URL}/widgets/${slug}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Kjører widgetens datakilde (read-only).
export async function fetchWidgetData(slug: string): Promise<QueryResult> {
  const res = await fetch(`${BASE_URL}/widgets/${slug}/query`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
