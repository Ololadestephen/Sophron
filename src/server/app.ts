import { Hono } from "hono";
import { cors } from "hono/cors";
import { paymentMiddleware } from "@x402/hono";
import { x402ResourceServer } from "@x402/core/server";
import type { RoutesConfig } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import type { DataProvider } from "../core/provider.js";
import type { ServerConfig } from "../core/config.js";
import { buildFacilitator } from "../core/facilitator.js";
import { validateRequest, productIdFromPath, priceForProduct } from "../core/catalog.js";
import type { PolicyContract, AgentRunRequestContract } from "../core/contracts.js";
import { SERVICE_CANDIDATES } from "../core/services.js";
import type { PaymentGate } from "../payment/gate.js";
import type { SqliteStore } from "../storage/sqlite-store.js";

export interface AgentRunner {
  run(request: AgentRunRequestContract): Promise<{ message: string; attemptId: string }>;
}

export interface AppServices {
  store: SqliteStore;
  policy: PolicyContract;
  gate: PaymentGate;
  agent: AgentRunner;
}

export const createApp = (
  provider: DataProvider,
  config: ServerConfig,
  services?: AppServices,
  options: { enablePaymentMiddleware?: boolean } = {},
): Hono => {
  const catalog = provider.catalog();
  const app = new Hono();

  app.use("*", cors({
    origin: config.dashboardOrigin,
    allowHeaders: ["Content-Type", "payment-signature"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }));

  const x402Server = new x402ResourceServer(buildFacilitator(config.facilitatorUrl)).register(
    "hedera:*",
    new ExactHederaScheme(),
  );

  const routes: RoutesConfig = {
    "GET /data/:product": {
      description: "Sophron demo API service — price and parameters vary by product",
      accepts: {
        scheme: "exact",
        network: config.hederaNetwork as Network,
        payTo: config.payToAccount,
        price: (ctx) => priceForProduct(catalog, productIdFromPath(ctx.path)),
        maxTimeoutSeconds: 180,
      },
    },
    "GET /untrusted/:product": {
      description: "Untrusted demo provider used to prove merchant policy rejection",
      accepts: {
        scheme: "exact",
        network: config.hederaNetwork as Network,
        payTo: config.untrustedPayToAccount,
        price: { amount: "500000", asset: "0.0.0" },
        maxTimeoutSeconds: 180,
      },
    },
  };

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  });

  app.get("/health", (c) => c.json({ status: "ok", service: "sophron", network: config.hederaNetwork }));

  app.get("/catalog", (c) =>
    c.json({ providerId: provider.id, products: catalog, services: SERVICE_CANDIDATES }),
  );

  if (services) {
    app.get("/api/policy", (c) =>
      c.json({ policy: services.policy, spend: services.store.getSpendSummary(services.policy) }),
    );

    app.get("/api/attempts", (c) => c.json({ attempts: services.store.listAttempts() }));

    app.get("/api/attempts/:id", (c) => {
      const attempt = services.store.getAttempt(c.req.param("id"));
      if (!attempt) return c.json({ error: "Attempt not found" }, 404);
      return c.json({ attempt, events: services.store.getEvents(attempt.id) });
    });

    app.post("/api/attempts/:id/approve", async (c) => {
      try {
        const attempt = await services.gate.approve(c.req.param("id"));
        return c.json({ attempt, events: services.store.getEvents(attempt.id) });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "Approval failed" }, 400);
      }
    });

    app.post("/api/attempts/:id/deny", (c) => {
      try {
        const attempt = services.gate.deny(c.req.param("id"));
        return c.json({ attempt, events: services.store.getEvents(attempt.id) });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "Denial failed" }, 400);
      }
    });

    app.post("/api/agent/run", async (c) => {
      try {
        const request = (await c.req.json()) as AgentRunRequestContract;
        if (!request.prompt || typeof request.prompt !== "string") {
          return c.json({ error: "prompt is required" }, 400);
        }
        const result = await services.agent.run(request);
        const attempt = services.store.requireAttempt(result.attemptId);
        return c.json({ message: result.message, attempt });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "Agent run failed" }, 400);
      }
    });

    app.post("/api/demo/reset", (c) => {
      if (!config.demoMode) {
        return c.json({ error: "Demo reset is disabled" }, 403);
      }
      services.store.reset();
      return c.json({
        ok: true as const,
        policy: { policy: services.policy, spend: services.store.getSpendSummary(services.policy) },
      });
    });
  }

  app.use("/data/:product", async (c, next) => {
    const productId = c.req.param("product");
    const error = validateRequest(catalog, productId, c.req.query());
    if (error) return c.json({ error: error.message }, error.status);
    await next();
  });

  app.use("/untrusted/:product", async (c, next) => {
    const productId = c.req.param("product");
    if (productId !== "risk-report") return c.json({ error: `Unknown product: ${productId}` }, 404);
    const error = validateRequest(catalog, productId, c.req.query());
    if (error) return c.json({ error: error.message }, error.status);
    await next();
  });

  if (options.enablePaymentMiddleware !== false) {
    app.use("*", paymentMiddleware(routes, x402Server));
  }

  app.get("/data/:product", async (c) => {
    const productId = c.req.param("product");
    const params = c.req.query();
    const result = await provider.fetch(productId, params);
    return c.json({
      product: productId,
      params,
      data: result.data,
      asOf: result.asOf,
      providerId: result.providerId,
    });
  });

  app.get("/untrusted/:product", async (c) => {
    const params = c.req.query();
    const result = await provider.fetch("risk-report", params);
    return c.json({
      product: "risk-report",
      params,
      data: result.data,
      asOf: result.asOf,
      providerId: "unknown-provider",
    });
  });

  return app;
};
