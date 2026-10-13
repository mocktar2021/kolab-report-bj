// @vitest-environment node
import { describe, expect, it } from "vitest";
import { escapeLineStarts, finishMarkdown, heading, storableText, tableToMarkdown } from "./markdown";
import { PARSE_LIMITS } from "./types";

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

describe("escapeLineStarts", () => {
  it.each([
    ["# titre", "\\# titre"],
    ["> cité", "\\> cité"],
    ["- tiret", "\\- tiret"],
    ["+ plus", "\\+ plus"],
    ["===", "\\==="],
    ["1984. Année", "1984\\. Année"],
    ["12) point", "12\\) point"],
    ["   # trois espaces", "   \\# trois espaces"],
    ["a\n- b\n1. c", "a\n\\- b\n1\\. c"],
  ])("escapes %j", (text, expected) => {
    expect(escapeLineStarts(text)).toBe(expected);
  });

  it.each(["texte # au milieu", "C#", "1234567890. trop long pour une liste", "2024 sans point"])(
    "leaves %j as it is",
    (text) => {
      expect(escapeLineStarts(text)).toBe(text);
    },
  );
});

describe("heading", () => {
  it("escapes a run of # that would close the heading", () => {
    expect(heading(2, "Langage C #")).toBe("## Langage C \\#");
    expect(heading(3, "##")).toBe("### \\##");
    expect(heading(1, "C#")).toBe("# C#");
  });
});

describe("storableText", () => {
  it("drops NUL bytes and replaces a lone surrogate", () => {
    expect(storableText("a\u0000b")).toBe("ab");
    expect(storableText("🌿".slice(0, 1))).toBe("�");
    expect(storableText("🌿")).toBe("🌿");
  });
});

describe("finishMarkdown", () => {
  it("doesn't leave half an emoji where it cuts the text", () => {
    const text = "🌿".repeat(PARSE_LIMITS.maxMarkdownChars);
    const { markdown, meta } = finishMarkdown(text, { kind: "text" });
    expect(meta.truncated).toBe(true);
    expect(markdown.isWellFormed()).toBe(true);
  });

  it("keeps two trailing spaces as a hard break and drops other trailing spaces", () => {
    expect(finishMarkdown("a  \nb \t\nc\t  \n   \nd", { kind: "text" }).markdown).toBe("a  \nb\nc\n\nd");
  });

  it("stays linear on a long run of spaces", () => {
    const start = performance.now();
    finishMarkdown(`a${" ".repeat(1_000_000)}b`, { kind: "text" });
    expect(performance.now() - start).toBeLessThan(5000);
  });
});
