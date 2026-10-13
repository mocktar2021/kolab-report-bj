import { describe, expect, it } from "vitest";
import { CHARS_PER_TOKEN, estimateTokens } from "./tokens";

describe("estimateTokens", () => {
  it("counts three characters per token, rounded up", () => {
    expect(CHARS_PER_TOKEN).toBe(3);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("abcd")).toBe(2);
    expect(estimateTokens("é".repeat(30))).toBe(10);
  });
});
