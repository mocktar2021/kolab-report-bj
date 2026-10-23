// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DraftOutput } from "@/lib/ai/schemas";
import { draftLengths } from "./judge";

describe("draftLengths", () => {
  it("counts the writer's fields of a section draft, not its title or sources", () => {
    const output: DraftOutput = {
      schema: "section_draft",
      value: {
        title: "Un titre qui ne compte pas",
        summary: "Deux mots.",
        body_markdown: "### Détail\n\n| Site | Fuites |\n| --- | --- |\n| Titirou | 12 |",
        recommendations: [],
        sources: [{ deliverable: "L1", detail: "Le rapport d'audit, qui ne compte pas." }],
      },
    };
    expect(draftLengths(output)).toBe("résumé 2 mots, corps 5 mots, recommandations 0 mot ; 7 mots en tout");
  });

  it("keeps the summary of an executive summary apart from its key points", () => {
    const output: DraftOutput = {
      schema: "executive_summary",
      value: {
        summary: "Trois mots ici.",
        key_points: ["Un point."],
        sources: [
          { deliverable: "L1", detail: "Le rapport." },
          { deliverable: "L2", detail: "Le tableau." },
        ],
      },
    };
    expect(draftLengths(output)).toBe("résumé 3 mots, points clés 2 mots ; 5 mots en tout");
  });

  it("skips the refs and the priority inside recommendations", () => {
    const output: DraftOutput = {
      schema: "recommendations",
      value: {
        introduction: "Une phrase.",
        recommendations: [
          {
            title: "Réparer vite",
            rationale: "Les fuites durent.",
            priority: "haute",
            priority_reason: "Coût élevé.",
            sources: ["L1"],
          },
        ],
        sources: [{ deliverable: "L1", detail: "Les délais de réparation." }],
      },
    };
    expect(draftLengths(output)).toBe("introduction 2 mots, recommandations 7 mots ; 9 mots en tout");
  });
});
