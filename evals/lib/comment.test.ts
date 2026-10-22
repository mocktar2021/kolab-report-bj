// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Budget } from "./budget";
import {
  COMMENT_MARKER,
  COMMENT_MAX_CHARS,
  limitComment,
  renderComment,
  renderErrorComment,
  type CommentInput,
} from "./comment";
import { compareWithBaseline, type Comparison } from "./compare";
import { applyGate, loadThresholds } from "./gate";
import type { RunInfo } from "./report";
import { aggregateSummaries, type CaseSummary } from "./summary";
import { baselineOf, caseSummary, prCases, runInfo, scores, VERSIONS } from "./testing";

const thresholds = loadThresholds();
const FILE = "evals/baseline/production.json";

function input(
  cases: CaseSummary[],
  options: {
    run?: Partial<RunInfo>;
    baseline?: CaseSummary[] | null;
    skipped?: string[];
    budget?: Budget;
  } = {},
): CommentInput {
  const run = runInfo({ judge: cases.some((value) => value.judge !== null), ...options.run });
  const aggregates = aggregateSummaries(cases);
  const comparison: Comparison =
    options.baseline === undefined
      ? { status: "off" }
      : compareWithBaseline(
          { cases, mock: run.mock, judge: run.judge, versions: VERSIONS },
          options.baseline === null ? null : baselineOf(options.baseline),
          thresholds.regression,
          FILE,
        );
  return {
    run,
    goldenCases: 15,
    selected: cases.length + (options.skipped?.length ?? 0),
    gate: applyGate(aggregates, thresholds, { mock: run.mock, skipped: options.skipped, ran: cases.length }),
    aggregates,
    cases,
    comparison,
    budget: (options.budget ?? new Budget({ usd: null, tokens: null }, false)).summary(),
    reportsDir: "evals/reports",
    runUrl: "https://github.com/acme/kolab/actions/runs/42",
  };
}

/** The verdict: the first bold line after the heading. */
function verdict(text: string): string {
  return text.split("\n").find((line) => line.startsWith("**")) ?? "";
}

describe("renderComment", () => {
  it("starts with the marker and says when nothing regressed", () => {
    const text = renderComment(input(prCases(), { baseline: prCases() }));
    expect(text.startsWith(`${COMMENT_MARKER}\n`)).toBe(true);
    expect(verdict(text)).toBe("**Aucune régression.**");
    expect(text).toContain("| Indicateur | Ce run | Minimum | Référence | Écart (limite) |");
    expect(text).toContain("| Citations valides | 100,0 % | 95,0 % | 100,0 % | 0,0 pt (-2 pts au plus) |");
    expect(text).toContain("comparé sur 6 cas communs");
    expect(text).toContain("[run](https://github.com/acme/kolab/actions/runs/42)");
    // No em dash anywhere in the comment.
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });

  it("puts a regression in the verdict and in bold in the table", () => {
    const cases = prCases().map((value) =>
      value.id === "mixed-c" ? { ...value, citationValid: false } : value,
    );
    const text = renderComment(input(cases, { baseline: prCases() }));
    expect(verdict(text)).toBe("**Régression : citations valides (-16,7 pts).**");
    // The template's prompt didn't change: its own drop only warns.
    expect(text).toContain("À surveiller : `synthese-section` : citations valides (-33,3 pts).");
    expect(text).toContain("| **Citations valides** | **83,3 %** | **95,0 %** | **100,0 %** |");
    expect(text).toContain("**Seuil non atteint : citations valides (83,3 % pour 95,0 % au minimum).**");
    expect(text).toContain("- `mixed-c` : perdu : citations valides");
    expect(text).toContain("- `mixed-c` : citations invalides");
  });

  it("groups the drops of a template whose prompt changed", () => {
    const cases = prCases().map((value) =>
      value.template === "analyse-donnees"
        ? { ...value, promptVersion: "cccc3333", ...(value.id === "xlsx-b" ? { lengthOk: false } : {}) }
        : value,
    );
    const text = renderComment(input(cases, { baseline: prCases() }));
    expect(verdict(text)).toBe("**Régression : `analyse-donnees` : longueur dans les bornes (-33,3 pts).**");
    expect(text).toContain(
      "| `analyse-donnees` | `bbbb2222` → `cccc3333` (modifiée) | 3 | **longueur dans les bornes -33,3 pts** |",
    );
    expect(text).toContain("| `synthese-section` | `aaaa1111` (inchangée) | 3 | aucune |");
  });

  it("names the judge criterion that dropped", () => {
    const before = prCases({ judge: scores(4) });
    const after = before.map((value) =>
      value.id === "docx-a" ? { ...value, judge: scores(4, { langue: 2 }) } : value,
    );
    const text = renderComment(input(after, { baseline: before }));
    expect(verdict(text)).toContain("juge : qualité de la langue et du ton (-0,33)");
    expect(text).toContain("- `docx-a` : juge : qualité de la langue et du ton 4 → 2");
  });

  it("says the quality run needs an API key on a mock run", () => {
    const cases = prCases({ model: "mock", keyPointCoverage: 0, lengthOk: false });
    const text = renderComment(input(cases, { run: { mock: true, provider: "mock", model: "mock" } }));
    expect(verdict(text).startsWith("**Évaluation qualité non lancée : pas de clé API.**")).toBe(true);
    expect(text).toContain("`ANTHROPIC_API_KEY`");
    expect(text).toContain("| Points clés couverts | 0,0 % | 70,0 % (non appliqué) |");
    expect(text).not.toContain("Seuil non atteint");
  });

  it("says when there is no baseline yet", () => {
    const text = renderComment(input(prCases(), { baseline: null }));
    expect(
      verdict(text).startsWith("**Aucune régression mesurée : pas encore de référence de production.**"),
    ).toBe(true);
    expect(text).toContain("| Référence | pas encore de fichier `evals/baseline/production.json` |");
    // No baseline column without a baseline.
    expect(text).toContain("| Indicateur | Ce run | Minimum |\n");
  });

  it("warns about cost without calling it a regression", () => {
    const text = renderComment(input(prCases({ costUsd: 0.06 }), { baseline: prCases() }));
    expect(verdict(text)).toBe("**Aucune régression.**");
    expect(text).toContain("À surveiller : coût par cas (+100 %).");
    expect(text).toContain("+100 % (alerte au-delà de +30 %, à surveiller)");
  });

  it("skips the latency of a batch run instead of warning about it", () => {
    const text = renderComment(
      input(prCases({ latencyMs: null }), { baseline: prCases(), run: { batch: true } }),
    );
    expect(verdict(text)).toBe("**Aucune régression.**");
    expect(text).not.toContain("À surveiller");
    expect(text).toContain("Latence de génération : non mesurée, les appels passent par la Batch API.");
  });

  it("lists the cases the budget skipped and calls the run incomplete", () => {
    const budget = new Budget({ usd: 2, tokens: null }, true);
    const text = renderComment(
      input(prCases().slice(0, 4), { baseline: prCases(), skipped: ["injection-e", "injection-f"], budget }),
    );
    expect(text).toContain("Run incomplet : 2 cas non lancés, budget atteint.");
    expect(text).toContain("Non lancés, budget atteint : `injection-e`, `injection-f`.");
    expect(text).toContain("| Budget | 2,00 USD au plus |");
  });

  it("fails loudly when no case ran", () => {
    const text = renderComment(
      input([], { baseline: prCases(), skipped: prCases().map((value) => value.id) }),
    );
    expect(verdict(text)).toBe("**Aucun cas lancé : le budget ne couvre pas le premier cas.**");
  });

  it("keeps long case lists short and the comment under GitHub's limit", () => {
    const cases = Array.from({ length: 400 }, (_, index) =>
      caseSummary(`cas-${index}`, {
        error: `APICallError: ${"surcharge ".repeat(30)}`,
        schemaValidAfterRepair: false,
      }),
    );
    const text = renderComment(
      input(cases, {
        baseline: cases.map((value) => ({ ...value, error: null, schemaValidAfterRepair: true })),
      }),
    );
    expect(text).toContain("- Et 385 autres dans les rapports du run.");
    expect(text.length).toBeLessThan(COMMENT_MAX_CHARS);
    expect(text.split("\n").filter((line) => line.startsWith("- `cas-")).length).toBe(30);
  });

  it("cuts a text over the limit at a line break", () => {
    const long = `${COMMENT_MARKER}\n${"ligne de rapport\n".repeat(10_000)}`;
    const cut = limitComment(long);
    expect(cut.length).toBeLessThanOrEqual(COMMENT_MAX_CHARS);
    expect(cut.startsWith(COMMENT_MARKER)).toBe(true);
    expect(cut).toContain("_Commentaire tronqué : la suite est dans les rapports du run._");
    expect(limitComment("court")).toBe("court");
  });
});

describe("renderErrorComment", () => {
  it("explains why the run did not start", () => {
    const text = renderErrorComment('subset "pr" lists unknown case ids: ```x```', null);
    expect(text.startsWith(COMMENT_MARKER)).toBe(true);
    expect(text).toContain("**Évaluation non lancée : erreur de configuration.**");
    expect(text).toContain("subset \"pr\" lists unknown case ids: '''x'''");
    expect(text.match(/```/g)).toHaveLength(2);
  });
});
