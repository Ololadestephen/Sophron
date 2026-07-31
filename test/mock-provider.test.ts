import { describe, it, expect } from "vitest";
import { generateData } from "../src/providers/mock/generator.js";
import { MockDataProvider } from "../src/providers/mock/mock-provider.js";

describe("MockDataProvider determinism", () => {
  it("generator yields identical output for identical input", () => {
    const input = { productId: "risk-report", symbol: "0.0.1234", windowSeed: 42 };
    expect(generateData(input)).toEqual(generateData(input));
  });

  it("generator differs across symbols", () => {
    const a = generateData({ productId: "risk-report", symbol: "0.0.1", windowSeed: 42 });
    const b = generateData({ productId: "risk-report", symbol: "0.0.2", windowSeed: 42 });
    expect(a).not.toEqual(b);
  });

  it("fetch returns the documented risk-report shape", async () => {
    const result = await new MockDataProvider().fetch("risk-report", { account: "0.0.1234" });
    expect(result.providerId).toBe("mock");
    expect(result.data).toHaveProperty("score");
    expect(result.data).toHaveProperty("signals");
  });

  it("fetch returns the documented market-brief shape", async () => {
    const result = await new MockDataProvider().fetch("market-brief", { symbol: "HBAR" });
    expect(result.data).toHaveProperty("referencePrice");
    expect(result.data).toHaveProperty("summary");
  });

  it("fetch rejects for unknown product", async () => {
    await expect(new MockDataProvider().fetch("does-not-exist", {})).rejects.toThrow();
  });
});
