import { describe, expect, it } from "vitest";
import { lowJudgeScores } from "./report";

const justifications = {
  fidelite: "Fidèle aux livrables.",
  couverture: "Tous les points clés.",
  structure: "Les intertitres ne suivent pas le plan demandé.",
  langue: "Ton professionnel.",
  actionnable: "Recommandations vagues.",
  citations: "Citations exactes.",
};

describe("lowJudgeScores (KRB-224)", () => {
  it("keeps the criteria scored 3 or less, with the judge's reason", () => {
    const judge = {
      scores: { fidelite: 5, couverture: 4, structure: 3, langue: 5, actionnable: 2, citations: 4 },
      justifications,
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
    };
    expect(lowJudgeScores({ judge })).toEqual([
      {
        key: "structure",
        label: "Structure et respect du schéma",
        score: 3,
        justification: "Les intertitres ne suivent pas le plan demandé.",
      },
      {
        key: "actionnable",
        label: "Caractère actionnable des recommandations",
        score: 2,
        justification: "Recommandations vagues.",
      },
    ]);
  });

  it("has nothing to say without a judge or when the judge failed", () => {
    expect(lowJudgeScores({ judge: null })).toEqual([]);
    expect(lowJudgeScores({ judge: { error: "timeout" } })).toEqual([]);
  });
});
