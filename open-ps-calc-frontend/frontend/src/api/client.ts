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
  searchItems: (params: Record<string, unknown>) =>
    request(`/data/items?${new URLSearchParams(params as any)}`) as Promise<{ items: any[]; total: number }>,
  getItem: (id: number, server: string) =>
    request(`/data/items/${id}?server=${server}`) as Promise<any>,
  searchMobs: (params: Record<string, unknown>) =>
    request(`/data/mobs?${new URLSearchParams(params as any)}`) as Promise<{ items: any[]; total: number }>,
  searchSkills: (params: Record<string, unknown>) =>
    request(`/data/skills?${new URLSearchParams(params as any)}`) as Promise<{ items: any[]; total: number }>,
  calculate: (payload: unknown) =>
    request("/calculate", { method: "POST", body: payload }) as Promise<any>,
};
