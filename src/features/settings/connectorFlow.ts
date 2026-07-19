// Ren data og typer for tilkoblings-veiviseren (ChatWizard). Ingen JSX, ingen
// AI — hele database-flyten er forhåndsdefinert her, ett felt om gangen.

export const SOURCE_OPTIONS = ["Database", "Databricks", "CSV", "Excel", "Cloud Storage"];

export const DRIVER_MAP: Record<string, { key: string; port: number; user: string }> = {
  PostgreSQL: { key: "postgres", port: 5432, user: "postgres" },
  MySQL: { key: "mysql", port: 3306, user: "root" },
  "SQL Server": { key: "mssql", port: 1433, user: "sa" },
};

export interface FlowStep {
  key: string;
  question: string;
  options: (answers: Record<string, string>) => string[];
  secret?: boolean;
}

export const DB_FLOW: FlowStep[] = [
  {
    key: "driver",
    question: "Hvilken databasetype?",
    options: () => Object.keys(DRIVER_MAP),
  },
  {
    key: "name",
    question: "Hva skal tilkoblingen hete?",
    options: () => [],
  },
  {
    key: "host",
    question: "Hvilken host kjører databasen på?",
    options: () => ["localhost"],
  },
  {
    key: "port",
    question: "Hvilken port?",
    options: (a) => [String(DRIVER_MAP[a.driver]?.port ?? 5432)],
  },
  {
    key: "database",
    question: "Hva heter databasen?",
    options: () => [],
  },
  {
    key: "user",
    question: "Hvilket brukernavn skal jeg logge inn med?",
    options: (a) => [DRIVER_MAP[a.driver]?.user ?? "postgres"].filter(Boolean),
  },
  {
    key: "password",
    question: "Og passordet? (lagres kryptert)",
    options: () => [],
    secret: true,
  },
];

export interface LogMsg {
  id: number;
  role: "bot" | "user";
  text: string;
}

// Fritekst som uttrykker at brukeren vil endre/angre noe (ikke et feltsvar).
// Kun da trengs AI for å tolke intensjon — vanlige feltsvar godtas i kode.
export const INSTRUCTION_RE = /\b(bytt|bytte|endre|endra|angre|vent|tilbake|feil)\b|\?/i;

// Frie felt der ethvert rimelig svar godtas direkte uten AI-validering.
export const FREE_FIELDS = new Set(["name", "host", "database", "user"]);

// matchDriver kjenner igjen databasetype fra fritekst uten AI. Tom = ukjent.
export function matchDriver(text: string): string {
  const t = text.trim().toLowerCase();
  if (/postgres/.test(t)) return "PostgreSQL";
  if (/mysql|maria/.test(t)) return "MySQL";
  if (/sql ?server|mssql/.test(t)) return "SQL Server";
  return Object.keys(DRIVER_MAP).find((k) => k.toLowerCase() === t) ?? "";
}
