import { BASE_URL, authHeaders } from "./client";

export interface AuthUser {
  id: string;
  tenant_id: string;
  email: string;
  role: string;
}

export async function requestCode(email: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/auth/request-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function verifyCode(
  email: string,
  code: string
): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${BASE_URL}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  if (res.status === 401) throw new Error("Ugyldig kode");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface AdminUser extends AuthUser {
  usage: {
    requests: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
  };
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const res = await fetch(`${BASE_URL}/admin/users`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).users ?? [];
}

export async function createAdminUser(
  email: string,
  role: string
): Promise<void> {
  const res = await fetch(`${BASE_URL}/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
}

export async function deleteAdminUser(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/admin/users/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function fetchMe(): Promise<{
  user: AuthUser;
  tenant: AuthTenant;
}> {
  const res = await fetch(`${BASE_URL}/auth/me`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
