import type { GameConfig, Language, PublicGameState } from "../shared/types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

export const api = {
  createSession: (config: GameConfig) => request<PublicGameState>("/api/sessions", { method: "POST", body: JSON.stringify(config) }),
  getSession: (id: string) => request<PublicGameState>(`/api/sessions/${id}`),
  action: (id: string, action: { type: string; amount?: number }) => request<PublicGameState>(`/api/sessions/${id}/action`, { method: "POST", body: JSON.stringify(action) }),
  next: (id: string) => request<PublicGameState>(`/api/sessions/${id}/next`, { method: "POST", body: "{}" }),
  language: (id: string, language: Language) => request<PublicGameState>(`/api/sessions/${id}/language`, { method: "POST", body: JSON.stringify({ language }) }),
  explain: (id: string) => request<{ explanation: string }>(`/api/sessions/${id}/explain`, { method: "POST", body: "{}" }),
};
