import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The nightly evals skip a night with no AI change since the last night that
// ran them (KRB-223). They must watch every file the PR gate watches, or a
// change merged through the gate would never get a full run.
const gate = readFileSync(".github/workflows/evals-pr.yml", "utf8");
const nightly = readFileSync(".github/workflows/evals.yml", "utf8");

/** The `paths` filter of the PR gate, without its own workflow file. */
function gatePaths(): string[] {
  const block = gate.split(/^ {4}paths:\n/m)[1] ?? "";
  const paths: string[] = [];
  for (const line of block.split("\n")) {
    const path = /^ {6}- "(.+)"$/.exec(line)?.[1];
    if (!path) break;
    paths.push(path);
  }
  return paths.filter((path) => path !== ".github/workflows/evals-pr.yml");
}

/** The script of the nightly step that decides whether the night runs. */
function nightlyCheck(): string {
  const start = nightly.indexOf("- name: Check what changed since the last run");
  const end = nightly.indexOf("\n  evals:\n");
  return start >= 0 && end > start ? nightly.slice(start, end) : "";
}

describe("nightly evals scope", () => {
  it("reads the PR gate's paths", () => {
    expect(gatePaths()).toContain("src/lib/ai/generate.ts");
    expect(nightlyCheck()).toContain("git diff");
  });

  it("watches every file the PR gate watches", () => {
    const check = nightlyCheck();
    const missing = gatePaths()
      .map((path) => path.replace(/\/\*\*$/, ""))
      .filter((path) => !check.includes(path));
    expect(missing).toEqual([]);
  });

  it("compares the settings in the job name it gives the golden set", () => {
    expect(nightly).toContain("name: Golden set (settings ${{ needs.scope.outputs.settings }})");
    expect(nightlyCheck()).toContain('"Golden set (settings $SETTINGS)"');
  });
});
