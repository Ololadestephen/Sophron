import { AgentMode, BaseTool, type Context, type Plugin } from "@hashgraph/hedera-agent-kit";
import { HederaLangchainToolkit } from "@hashgraph/hedera-agent-kit-langchain";
import { Client } from "@hiero-ledger/sdk";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { z } from "zod";
import type { AgentRunRequestContract, AttemptContract } from "../core/contracts.js";
import { findService, SERVICE_CANDIDATES } from "../core/services.js";
import type { PaymentGate } from "../payment/gate.js";
import type { AgentRunner } from "../server/app.js";

const purchaseParameters = z.object({
  serviceId: z.enum(["risk-report", "market-brief", "unknown-provider"]),
  input: z.record(z.string()).optional().default({}),
});

type PurchaseParameters = z.infer<typeof purchaseParameters>;

export class PurchaseServiceTool extends BaseTool<PurchaseParameters, PurchaseParameters> {
  method = "purchase_service";
  name = "purchase_service";
  description =
    "Purchase one service through Sophron's deterministic policy gate. Use only a listed serviceId; policy code controls signing and funds.";
  parameters = purchaseParameters;
  lastAttempt: AttemptContract | null = null;

  constructor(private readonly gate: PaymentGate) {
    super();
  }

  async normalizeParams(params: PurchaseParameters): Promise<PurchaseParameters> {
    const parsed = purchaseParameters.parse(params);
    if (!findService(parsed.serviceId)) throw new Error(`Unknown service: ${parsed.serviceId}`);
    return parsed;
  }

  async coreAction(params: PurchaseParameters): Promise<AttemptContract> {
    const attempt = await this.gate.purchase({ serviceId: params.serviceId, params: params.input });
    this.lastAttempt = attempt;
    return attempt;
  }

  async shouldSecondaryAction(): Promise<boolean> {
    return false;
  }

  async secondaryAction(request: AttemptContract): Promise<AttemptContract> {
    return request;
  }
}

const heuristicService = (prompt: string): PurchaseParameters["serviceId"] => {
  const normalized = prompt.toLowerCase();
  if (normalized.includes("unknown") || normalized.includes("untrusted") || normalized.includes("discount")) {
    return "unknown-provider";
  }
  if (normalized.includes("market") || normalized.includes("premium") || normalized.includes("brief")) {
    return "market-brief";
  }
  return "risk-report";
};

export class SophronAgent implements AgentRunner {
  private readonly client = Client.forTestnet();
  private readonly tool: PurchaseServiceTool;
  private readonly toolkit: HederaLangchainToolkit;
  private readonly context: Context = { mode: AgentMode.AUTONOMOUS };

  constructor(
    gate: PaymentGate,
    private readonly modelName: string,
  ) {
    this.tool = new PurchaseServiceTool(gate);
    const plugin: Plugin = {
      name: "sophron-x402",
      version: "1.0.0",
      description: "Policy-controlled x402 purchases on Hedera",
      tools: () => [this.tool],
    };
    this.toolkit = new HederaLangchainToolkit({
      client: this.client,
      configuration: { plugins: [plugin], context: this.context },
    });
  }

  async run(request: AgentRunRequestContract): Promise<{ message: string; attemptId: string }> {
    if (!process.env.OPENAI_API_KEY) {
      const serviceId = request.serviceId ?? heuristicService(request.prompt);
      const result = await this.tool.execute(this.client, this.context, {
        serviceId: serviceId as PurchaseParameters["serviceId"],
        input: request.params ?? {},
      });
      const attempt = this.extractAttempt(result);
      return {
        message: `Sophron used its minimal Agent Kit tool runner (no model key configured) to evaluate ${attempt.serviceName}.`,
        attemptId: attempt.id,
      };
    }

    this.tool.lastAttempt = null;
    const agent = createAgent({
      model: new ChatOpenAI({
        model: this.modelName,
        apiKey: process.env.OPENAI_API_KEY,
        temperature: 0,
      }),
      // Agent Kit v4 currently pins a slightly older @langchain/core patch than
      // langchain's createAgent type surface. The runtime contracts are identical.
      tools: this.toolkit.getTools() as never,
      systemPrompt: [
        "You are Sophron, a purchasing agent with deterministic financial controls.",
        "Call purchase_service exactly once. Never invent payment amounts, destinations, or service IDs.",
        `Available services: ${SERVICE_CANDIDATES.map((service) => `${service.id} (${service.description})`).join(", ")}.`,
        "Policy code, not your reasoning, decides whether signing is allowed.",
      ].join(" "),
    });
    const requestedService = request.serviceId
      ? `\nThe user explicitly selected serviceId ${request.serviceId}; use that exact serviceId.`
      : "";
    const response = await agent.invoke({
      messages: [{ role: "user", content: `${request.prompt}${requestedService}` }],
    });
    const attempt = this.tool.lastAttempt as AttemptContract | null;
    if (!attempt) throw new Error("Agent completed without calling purchase_service");
    const lastMessage = response.messages.at(-1);
    const content = typeof lastMessage?.content === "string" ? lastMessage.content : "Sophron evaluated the purchase.";
    return { message: content, attemptId: attempt.id };
  }

  private extractAttempt(result: unknown): AttemptContract {
    if (result && typeof result === "object" && "id" in result) return result as AttemptContract;
    if (result && typeof result === "object" && "raw" in result) {
      const raw = (result as { raw?: unknown }).raw;
      if (raw && typeof raw === "object" && "id" in raw) return raw as AttemptContract;
    }
    throw new Error("Agent Kit purchase tool did not return an attempt");
  }
}
