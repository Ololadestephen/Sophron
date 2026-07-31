import { getApiBaseUrl } from "./config";
import type {
  AgentRunRequestContract,
  AgentRunResponseContract,
  AttemptResponseContract,
  AttemptsResponseContract,
  DemoResetResponseContract,
  PolicyResponseContract,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBaseUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    throw new ApiError(`Backend unreachable: ${msg}`, 0);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(text || res.statusText || `HTTP ${res.status}`, res.status, text);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError("Invalid JSON from API", res.status, text);
  }
}

export const api = {
  getPolicy: () => request<PolicyResponseContract>("/api/policy"),
  getAttempts: () => request<AttemptsResponseContract>("/api/attempts"),
  getAttempt: (id: string) =>
    request<AttemptResponseContract>(`/api/attempts/${encodeURIComponent(id)}`),
  approve: (id: string) =>
    request<AttemptResponseContract>(`/api/attempts/${encodeURIComponent(id)}/approve`, {
      method: "POST",
    }),
  deny: (id: string) =>
    request<AttemptResponseContract>(`/api/attempts/${encodeURIComponent(id)}/deny`, {
      method: "POST",
    }),
  runAgent: (body: AgentRunRequestContract) =>
    request<AgentRunResponseContract>("/api/agent/run", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  resetDemo: () =>
    request<DemoResetResponseContract>("/api/demo/reset", { method: "POST" }),
};
