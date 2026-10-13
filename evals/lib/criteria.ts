// The six criteria of the review rubric (evals/rubric.md). Human reviewers,
// the LLM judge and the agreement script share these keys, which are also
// the column names of evals/human/*.csv.

export const CRITERIA = [
  { key: "fidelite", label: "Fidélité aux livrables" },
  { key: "couverture", label: "Couverture des points clés" },
  { key: "structure", label: "Structure et respect du schéma" },
  { key: "langue", label: "Qualité de la langue et du ton" },
  { key: "actionnable", label: "Caractère actionnable des recommandations" },
  { key: "citations", label: "Exactitude des citations" },
] as const;

export type Criterion = (typeof CRITERIA)[number]["key"];

export const CRITERION_KEYS = CRITERIA.map((criterion) => criterion.key) as [Criterion, ...Criterion[]];

export type Scores = Record<Criterion, number>;

/** Lowest and highest score of the rubric. */
export const SCORE_MIN = 1;
export const SCORE_MAX = 5;
