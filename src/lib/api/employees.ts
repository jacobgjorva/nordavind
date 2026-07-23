import { apiFetch } from "./client";

export interface Employee {
  id: string;
  name: string;
  role: string;
  description: string;
  email: string;
  created_at: string;
}

export interface EmployeeInput {
  name: string;
  role: string;
  description: string;
  email: string;
}

export async function listEmployees(): Promise<Employee[]> {
  const data = await apiFetch<{ employees?: Employee[] }>("/employees");
  return data.employees ?? [];
}

export async function createEmployee(payload: EmployeeInput): Promise<Employee> {
  return apiFetch("/employees", { method: "POST", body: payload });
}

export async function updateEmployee(id: string, payload: EmployeeInput): Promise<void> {
  await apiFetch(`/employees/${id}`, { method: "PUT", body: payload });
}

export async function deleteEmployee(id: string): Promise<void> {
  await apiFetch(`/employees/${id}`, { method: "DELETE" });
}
