import { BASE_URL, authHeaders } from "./client";

export interface DailyUsage {
  day: string;
  model: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  searches: number;
}

export async function fetchDailyUsage(
  days: number,
  scope: "me" | "tenant"
): Promise<{ usage: DailyUsage[]; usdNok: number }> {
  const res = await fetch(
    `${BASE_URL}/usage/daily?days=${days}&scope=${scope}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return { usage: body.usage ?? [], usdNok: body.usd_nok ?? 0 };
}
