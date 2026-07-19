import { BASE_URL, authHeaders } from "./client";

export interface Connection {
  id: string;
  name: string;
  driver: string;
}

export interface DbColumn {
  name: string;
  type: string;
}

export interface DbTable {
  name: string;
  columns: DbColumn[];
}

export interface DbLink {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
}

export interface TableConfig {
  name: string;
  description: string;
  columns: Record<string, string>;
  user_ids: string[];
}

export interface DbView {
  name: string;
  sql: string;
  description: string;
}

export interface ConnectionSchema {
  connection: Connection;
  tables: DbTable[];
  suggested_links: DbLink[] | null;
  config: {
    tables: TableConfig[] | null;
    links: DbLink[] | null;
    views: DbView[] | null;
  };
}

export async function fetchConnections(): Promise<Connection[]> {
  const res = await fetch(`${BASE_URL}/connections`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).connections ?? [];
}

export async function createConnection(payload: {
  name: string;
  driver: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): Promise<Connection> {
  const res = await fetch(`${BASE_URL}/connections`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return res.json();
}

export async function testConnection(payload: {
  driver: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): Promise<void> {
  const res = await fetch(`${BASE_URL}/connections/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
}

export async function deleteConnection(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/connections/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function fetchConnectionSchema(id: string): Promise<ConnectionSchema> {
  const res = await fetch(`${BASE_URL}/connections/${id}/schema`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return res.json();
}

export async function saveConnectionConfig(
  id: string,
  tables: TableConfig[],
  links: DbLink[],
  views: DbView[]
): Promise<void> {
  const res = await fetch(`${BASE_URL}/connections/${id}/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ tables, links, views }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
