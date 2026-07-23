import { apiFetch, ApiError } from "./client";

export interface AuthUser {
  id: string;
  tenant_id: string;
  email: string;
  role: string;
}

export interface AuthTenant {
  id: string;
  name: string;
}

export async function requestCode(email: string): Promise<void> {
  await apiFetch("/auth/request-code", { method: "POST", body: { email } });
}

export async function verifyCode(
  email: string,
  code: string
): Promise<{ token: string; user: AuthUser }> {
  try {
    return await apiFetch("/auth/verify", {
      method: "POST",
      body: { email, code },
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      throw new Error("Ugyldig kode");
    }
    throw err;
  }
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
  const data = await apiFetch<{ users?: AdminUser[] }>("/admin/users");
  return data.users ?? [];
}

export async function createAdminUser(
  email: string,
  role: string
): Promise<void> {
  await apiFetch("/admin/users", { method: "POST", body: { email, role } });
}

export async function deleteAdminUser(id: string): Promise<void> {
  await apiFetch(`/admin/users/${id}`, { method: "DELETE" });
}

export async function fetchMe(): Promise<{
  user: AuthUser;
  tenant: AuthTenant;
}> {
  return apiFetch("/auth/me");
}
