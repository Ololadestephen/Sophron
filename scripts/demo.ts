import "dotenv/config";
import type {
  AgentRunResponseContract,
  AttemptResponseContract,
  AttemptStatus,
  DemoResetResponseContract,
} from "../src/core/contracts.js";

const baseUrl = process.env.SERVER_URL ?? "http://localhost:4021";

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    const message = "error" in (body as object) ? (body as { error?: string }).error : undefined;
    throw new Error(`${init?.method ?? "GET"} ${path} failed (${response.status}): ${message ?? "unknown error"}`);
  }
  return body as T;
};

const runService = async (serviceId: string, prompt: string): Promise<AgentRunResponseContract> =>
  requestJson<AgentRunResponseContract>("/api/agent/run", {
    method: "POST",
    body: JSON.stringify({ prompt, serviceId }),
  });

const expectStatus = (label: string, actual: AttemptStatus, expected: AttemptStatus): void => {
  const mark = actual === expected ? "PASS" : "FAIL";
  console.log(`${mark} ${label}: ${actual}`);
  if (actual !== expected) process.exitCode = 1;
};

console.log(`Sophron deterministic demo against ${baseUrl}`);
await requestJson<DemoResetResponseContract>("/api/demo/reset", { method: "POST", body: "{}" });

const automatic = await runService("risk-report", "Buy the allowlisted low-cost account risk report.");
expectStatus("automatic purchase", automatic.attempt.status, "fulfilled");
if (automatic.attempt.hashscanUrl) console.log(`     ${automatic.attempt.hashscanUrl}`);

const rejected = await runService("unknown-provider", "Try the untrusted discount provider.");
expectStatus("unknown merchant blocked", rejected.attempt.status, "rejected");

const pending = await runService("market-brief", "Buy the premium HBAR market brief.");
expectStatus("high-cost purchase paused", pending.attempt.status, "pending_approval");

if (pending.attempt.status === "pending_approval") {
  const approved = await requestJson<AttemptResponseContract>(`/api/attempts/${pending.attempt.id}/approve`, {
    method: "POST",
    body: "{}",
  });
  expectStatus("human-approved purchase", approved.attempt.status, "fulfilled");
  if (approved.attempt.hashscanUrl) console.log(`     ${approved.attempt.hashscanUrl}`);
}

if (process.exitCode) throw new Error("One or more demo assertions failed");
console.log("Sophron demo complete.");
