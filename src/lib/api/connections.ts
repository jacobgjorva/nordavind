import { apiFetch } from "./client";

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
  const data = await apiFetch<{ connections?: Connection[] }>("/connections");
  return data.connections ?? [];
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
  return apiFetch("/connections", { method: "POST", body: payload });
}

export async function deleteConnection(id: string): Promise<void> {
  await apiFetch(`/connections/${id}`, { method: "DELETE" });
}

export async function fetchConnectionSchema(id: string): Promise<ConnectionSchema> {
  return apiFetch(`/connections/${id}/schema`);
}

export async function saveConnectionConfig(
  id: string,
  tables: TableConfig[],
  links: DbLink[],
  views: DbView[]
): Promise<void> {
  await apiFetch(`/connections/${id}/config`, {
    method: "PUT",
    body: { tables, links, views },
  });
}
