import { apiFetch } from "./client";

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
  const body = await apiFetch<{ usage?: DailyUsage[]; usd_nok?: number }>(
    `/usage/daily?days=${days}&scope=${scope}`
  );
  return { usage: body.usage ?? [], usdNok: body.usd_nok ?? 0 };
}
