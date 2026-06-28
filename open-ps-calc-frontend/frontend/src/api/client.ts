const API_KEY = import.meta.env.VITE_API_KEY;

async function request(path: string, { method = "GET", body }: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers["X-API-Key"] = API_KEY;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    const message = (data && typeof data === "object" && (data as any).error) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export const api = {
  listJobs: () =>
    request("/data/jobs") as Promise<{ id: number; name: string }[]>,
  getJobPassives: (jobId: number, server: string) =>
    request(`/data/skill-tree/${jobId}?server=${server}`) as Promise<{ name: string; mastery_key: string; description: string; max_level: number }[]>,
  getJobBonusStats: (jobId: number, jobLevel: number, server: string) =>
    request(`/data/job-bonus-stats/${jobId}?job_level=${jobLevel}&server=${server}`) as Promise<{ str_: number; agi: number; vit: number; int_: number; dex: number; luk: number }>,
  searchItems: (params: Record<string, unknown>) =>
    request(`/data/items?${new URLSearchParams(params as any)}`) as Promise<{ items: any[]; total: number }>,
  getItem: (id: number, server: string) =>
    request(`/data/items/${id}?server=${server}`) as Promise<any>,
  searchMobs: (params: Record<string, unknown>) =>
    request(`/data/mobs?${new URLSearchParams(params as any)}`) as Promise<{ items: any[]; total: number }>,
  searchSkills: (params: Record<string, unknown>) =>
    request(`/data/skills?${new URLSearchParams(params as any)}`) as Promise<{ items: any[]; total: number }>,
  getGearStatBonuses: (build: unknown) =>
    request("/calculate/gear-stat-bonuses", { method: "POST", body: { build } }) as Promise<{ str_: number; agi: number; vit: number; int_: number; dex: number; luk: number }>,
  getCharacterStatus: (build: unknown) =>
    request("/calculate/status", { method: "POST", body: { build } }) as Promise<{
      max_hp: number; max_sp: number; hp_regen: number; sp_regen: number;
      batk: number; weapon_atk: number; matk_min: number; matk_max: number;
      hard_def: number; soft_def: number; hard_mdef: number; soft_mdef: number;
      aspd: number; cri: number; flee: number;
    }>,
  calculate: (payload: unknown) =>
    request("/calculate", { method: "POST", body: payload }) as Promise<any>,
};
