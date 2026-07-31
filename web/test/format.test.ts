import { describe, it, expect } from "vitest";
import { tinybarToHbar, formatHbar, truncateMiddle } from "../src/lib/format.js";

describe("tinybarToHbar", () => {
  it("converts fractional HBAR without float drift", () => {
    expect(tinybarToHbar("1000000")).toBe("0.01");
    expect(tinybarToHbar("2000000")).toBe("0.02");
    expect(tinybarToHbar("5000000")).toBe("0.05");
    expect(tinybarToHbar("10000000")).toBe("0.1");
    expect(tinybarToHbar("35000000")).toBe("0.35");
  });

  it("converts whole HBAR", () => {
    expect(tinybarToHbar("100000000")).toBe("1");
    expect(tinybarToHbar("250000000")).toBe("2.5");
  });

  it("handles zero and leading zeros", () => {
    expect(tinybarToHbar("0")).toBe("0");
    expect(tinybarToHbar("000")).toBe("0");
    expect(tinybarToHbar("000100000000")).toBe("1");
  });

  it("handles negative amounts", () => {
    expect(tinybarToHbar("-1000000")).toBe("-0.01");
  });

  it("rejects non-integer strings", () => {
    expect(() => tinybarToHbar("1.5")).toThrow();
    expect(() => tinybarToHbar("abc")).toThrow();
  });
});

describe("formatHbar", () => {
  it("appends unit", () => {
    expect(formatHbar("1000000")).toBe("0.01 ℏ");
  });
});

describe("truncateMiddle", () => {
  it("shortens long ids", () => {
    const id = "0.0.4515756@1721912532.123456789";
    const out = truncateMiddle(id, 10, 8);
    expect(out.includes("…")).toBe(true);
    expect(out.length).toBeLessThan(id.length);
  });
});
