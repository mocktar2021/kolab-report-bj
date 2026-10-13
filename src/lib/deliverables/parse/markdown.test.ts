// @vitest-environment node
import { describe, expect, it } from "vitest";
import { tableToMarkdown } from "./markdown";

describe("tableToMarkdown pipes", () => {
  it("escapes a pipe after no backslash or an escaped one", () => {
    expect(tableToMarkdown([["a|b", "c\\\\|d"]])).toBe("| a\\|b | c\\\\\\|d |\n| --- | --- |");
  });

  it("leaves a pipe that a backslash already escapes", () => {
    expect(tableToMarkdown([["a\\|b"]])).toBe("| a\\|b |\n| --- |");
  });

  it("stays linear on long runs of backslashes", () => {
    const cell = `${"\\".repeat(1_000_000)}x|${"\\|".repeat(250_000)}`;
    const start = performance.now();
    tableToMarkdown([[cell]]);
    expect(performance.now() - start).toBeLessThan(5000);
  });
});
