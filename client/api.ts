import type { GameConfig, Language, PublicGameState } from "../shared/types";
import type { HistoryExport, HistoryFilters, LifetimeStats, LocalPlayerProfile, StoredHandDetail, StoredHandSummary, StoredSessionSummary } from "../shared/history";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

export const api = {
  profiles: () => request<LocalPlayerProfile[]>("/api/profiles"),
  createProfile: (displayName: string) => request<LocalPlayerProfile>("/api/profiles", { method: "POST", body: JSON.stringify({ displayName }) }),
  renameProfile: (id: string, displayName: string) => request<LocalPlayerProfile>(`/api/profiles/${id}`, { method: "PATCH", body: JSON.stringify({ displayName }) }),
  deleteProfile: (id: string) => request<void>(`/api/profiles/${id}`, { method: "DELETE" }),
  profileStats: (id: string, filters: HistoryFilters = {}) => request<LifetimeStats>(`/api/profiles/${id}/stats?${query(filters)}`),
  profileSessions: (id: string) => request<StoredSessionSummary[]>(`/api/profiles/${id}/sessions`),
  profileHands: (id: string, filters: HistoryFilters = {}) => request<StoredHandSummary[]>(`/api/profiles/${id}/hands?${query(filters)}`),
  hand: (id: string) => request<StoredHandDetail>(`/api/hands/${id}`),
  reviewHand: (id: string, isMarkedForReview: boolean, reviewNote: string) => request<StoredHandDetail>(`/api/hands/${id}/review`, { method: "PATCH", body: JSON.stringify({ isMarkedForReview, reviewNote }) }),
  exportProfile: (id: string, filters: HistoryFilters = {}) => request<HistoryExport>(`/api/profiles/${id}/export`, { method: "POST", body: JSON.stringify(filters) }),
  exportCsv: async (id: string, filters: HistoryFilters = {}) => {
    const response = await fetch(`/api/profiles/${id}/export?format=csv`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(filters) });
    if (!response.ok) throw new Error("Export failed");
    return response.text();
  },
  backup: () => request<{ path: string }>("/api/backup", { method: "POST", body: "{}" }),
  info: () => request<{ dataDirectory: string; databasePath: string; schemaVersion: number }>("/api/info"),
  createSession: (config: GameConfig, profileId: string) => request<PublicGameState>("/api/sessions", { method: "POST", body: JSON.stringify({ ...config, profileId }) }),
  getSession: (id: string) => request<PublicGameState>(`/api/sessions/${id}`),
  action: (id: string, action: { type: string; amount?: number }) => request<PublicGameState>(`/api/sessions/${id}/action`, { method: "POST", body: JSON.stringify(action) }),
  next: (id: string) => request<PublicGameState>(`/api/sessions/${id}/next`, { method: "POST", body: "{}" }),
  language: (id: string, language: Language) => request<PublicGameState>(`/api/sessions/${id}/language`, { method: "POST", body: JSON.stringify({ language }) }),
  explain: (id: string) => request<{ explanation: string }>(`/api/sessions/${id}/explain`, { method: "POST", body: "{}" }),
  endSession: (id: string) => request<void>(`/api/sessions/${id}/end`, { method: "POST", body: "{}" }),
};

function query(filters: HistoryFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined) params.set(key, String(value));
  return params.toString();
}
