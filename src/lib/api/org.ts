import { apiFetch } from "./client";

// Org-modellen (kunnskapsgraf v2): enheter er ryggraden for kunnskaps-scope.
// Registreres strukturert i onboarding/admin — aldri gjettet fra chat.

export interface OrgUnit {
  id: string;
  name: string;
  parent_id?: string;
  created_at: string;
}

export interface OrgMe {
  unit_id: string;
  unit_name: string;
  role: string;
}

export async function listUnits(): Promise<OrgUnit[]> {
  const data = await apiFetch<{ units?: OrgUnit[] }>("/org/units");
  return data.units ?? [];
}

export async function createUnit(name: string): Promise<OrgUnit> {
  return apiFetch("/org/units", { method: "POST", body: { name } });
}

export async function updateUnit(id: string, name: string): Promise<void> {
  await apiFetch(`/org/units/${id}`, { method: "PUT", body: { name } });
}

export async function deleteUnit(id: string): Promise<void> {
  await apiFetch(`/org/units/${id}`, { method: "DELETE" });
}

// orgMe: brukerens egen org-posisjon — styrer hvilke scope-valg som vises
// («Min enhet» finnes bare når brukeren har en enhet).
export async function orgMe(): Promise<OrgMe> {
  return apiFetch("/org/me");
}

// Synlighetsvalget som sendes med dokumenter og minnekort. Tomt = arv
// (enheten hvis den finnes, ellers hele firmaet).
export type KnowledgeScope = "" | "tenant" | "unit" | "private";
