import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CRITERIA, SCORE_MAX, SCORE_MIN, type Criterion } from "../lib/criteria";
import { parseCsvRecords } from "../lib/csv";

// Human scores (evals/human/*.csv) and agreement between the two reviewers.
// Agreement is the quadratic weighted Cohen's kappa, per criterion: 1 means
// the reviewers always agree, 0 means no better than chance, and a gap of
// two points weighs four times a gap of one. Run it with
// `npm run eval:agreement -- evals/human/<file>.csv` (all sheets without a path).

export const HUMAN_DIR = "evals/human";
export const TEMPLATE_FILE = "scores.template.csv";

/** Target from evals/rubric.md. Below it, the criterion is discussed again before its scores are used. */
export const KAPPA_TARGET = 0.6;

/** Fewer items than this and the kappa says little, whatever its value. */
export const MIN_ITEMS = 5;

export const REQUIRED_COLUMNS = ["case_id", "reviewer", "prompt_version", "model"] as const;

export type HumanScore = {
  caseId: string;
  reviewer: string;
  promptVersion: string;
  model: string;
  scores: Partial<Record<Criterion, number>>;
  comment: string;
};

export type ParsedScores = { rows: HumanScore[]; errors: string[] };

/** Reads one score sheet. Empty score cells mean "not scored"; anything else must be 1 to 5. */
export function parseHumanScores(text: string, source = "scores.csv"): ParsedScores {
  const records = parseCsvRecords(text);
  const errors: string[] = [];
  const rows: HumanScore[] = [];
  const header = records[0] ? Object.keys(records[0]) : [];
  const missing = [...REQUIRED_COLUMNS, ...CRITERIA.map((criterion) => criterion.key)].filter(
    (column) => records.length > 0 && !header.includes(column),
  );
  if (missing.length > 0) return { rows, errors: [`${source}: missing columns ${missing.join(", ")}`] };

  records.forEach((record, index) => {
    const line = index + 2;
    const scores: Partial<Record<Criterion, number>> = {};
    for (const { key } of CRITERIA) {
      const cell = record[key] ?? "";
      if (cell === "") continue;
      const score = Number(cell);
      if (!Number.isInteger(score) || score < SCORE_MIN || score > SCORE_MAX) {
        errors.push(
          `${source}:${line}: ${key} must be an integer from ${SCORE_MIN} to ${SCORE_MAX}, got "${cell}"`,
        );
        continue;
      }
      scores[key] = score;
    }
    const [caseId, reviewer, promptVersion, model] = REQUIRED_COLUMNS.map((column) => record[column] ?? "");
    if (!caseId || !reviewer || !promptVersion || !model) {
      errors.push(`${source}:${line}: case_id, reviewer, prompt_version and model are required`);
      return;
    }
    rows.push({ caseId, reviewer, promptVersion, model, scores, comment: record.comment ?? "" });
  });
  return { rows, errors };
}

/** Every filled score sheet in evals/human, the template left out. */
export function loadHumanScores(dir = resolve(HUMAN_DIR)): ParsedScores {
  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".csv") && name !== TEMPLATE_FILE);
  } catch {
    return { rows: [], errors: [] };
  }
  const result: ParsedScores = { rows: [], errors: [] };
  for (const name of files.sort()) {
    const parsed = parseHumanScores(readFileSync(join(dir, name), "utf8"), name);
    result.rows.push(...parsed.rows);
    result.errors.push(...parsed.errors);
  }
  return result;
}

/**
 * Quadratic weighted Cohen's kappa for two raters on a SCORE_MIN..SCORE_MAX
 * scale: 1 - sum(w * observed) / sum(w * expected), with w = (i - j)^2 /
 * (k - 1)^2, observed the joint counts and expected the product of the two
 * raters' own counts divided by the number of items. Null without items, or
 * when both raters gave one and the same score to everything (no variance,
 * kappa undefined).
 */
export function quadraticWeightedKappa(
  pairs: ReadonlyArray<readonly [number, number]>,
  min = SCORE_MIN,
  max = SCORE_MAX,
): number | null {
  const size = max - min + 1;
  const n = pairs.length;
  if (n === 0) return null;
  const observed = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const first = new Array<number>(size).fill(0);
  const second = new Array<number>(size).fill(0);
  for (const [a, b] of pairs) {
    if (a < min || a > max || b < min || b > max) throw new RangeError(`score out of range: ${a}, ${b}`);
    const row = observed[a - min];
    if (row) row[b - min] = (row[b - min] ?? 0) + 1;
    first[a - min] = (first[a - min] ?? 0) + 1;
    second[b - min] = (second[b - min] ?? 0) + 1;
  }
  let disagreement = 0;
  let expected = 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const weight = (i - j) ** 2 / (size - 1) ** 2;
      disagreement += weight * (observed[i]?.[j] ?? 0);
      expected += (weight * (first[i] ?? 0) * (second[j] ?? 0)) / n;
    }
  }
  if (expected === 0) return null;
  return 1 - disagreement / expected;
}

export type CriterionAgreement = {
  criterion: Criterion;
  label: string;
  /** Items scored by exactly two reviewers on this criterion. */
  items: number;
  kappa: number | null;
  /** Share of items with the same score. */
  exact: number | null;
  status: "ok" | "low" | "few-items";
};

export type Disagreement = {
  caseId: string;
  promptVersion: string;
  model: string;
  criterion: Criterion;
  scores: { reviewer: string; score: number }[];
};

export type AgreementReport = {
  reviewers: string[];
  criteria: CriterionAgreement[];
  /** Gaps of 2 points or more, to discuss (evals/rubric.md). */
  disagreements: Disagreement[];
  warnings: string[];
};

function itemKey(row: HumanScore): string {
  return `${row.caseId}|${row.promptVersion}|${row.model}`;
}

export function agreement(rows: readonly HumanScore[]): AgreementReport {
  const warnings: string[] = [];
  const items = new Map<string, Map<string, HumanScore>>();
  for (const row of rows) {
    const key = itemKey(row);
    const byReviewer = items.get(key) ?? new Map<string, HumanScore>();
    if (byReviewer.has(row.reviewer))
      warnings.push(`${key}: ${row.reviewer} scored twice, the last row counts`);
    byReviewer.set(row.reviewer, row);
    items.set(key, byReviewer);
  }

  const disagreements: Disagreement[] = [];
  const criteria = CRITERIA.map(({ key: criterion, label }): CriterionAgreement => {
    const pairs: [number, number][] = [];
    for (const [key, byReviewer] of items) {
      const scored = [...byReviewer.values()]
        .filter((row) => row.scores[criterion] !== undefined)
        .sort((a, b) => a.reviewer.localeCompare(b.reviewer));
      if (scored.length < 2) continue;
      if (scored.length > 2) {
        warnings.push(`${key}: ${scored.length} reviewers on ${criterion}, the item is left out`);
        continue;
      }
      const [a, b] = scored as [HumanScore, HumanScore];
      const pair: [number, number] = [a.scores[criterion] ?? 0, b.scores[criterion] ?? 0];
      pairs.push(pair);
      if (Math.abs(pair[0] - pair[1]) >= 2) {
        disagreements.push({
          caseId: a.caseId,
          promptVersion: a.promptVersion,
          model: a.model,
          criterion,
          scores: [
            { reviewer: a.reviewer, score: pair[0] },
            { reviewer: b.reviewer, score: pair[1] },
          ],
        });
      }
    }
    const kappa = quadraticWeightedKappa(pairs);
    const exact = pairs.length === 0 ? null : pairs.filter(([a, b]) => a === b).length / pairs.length;
    const status =
      pairs.length < MIN_ITEMS ? "few-items" : kappa !== null && kappa >= KAPPA_TARGET ? "ok" : "low";
    return { criterion, label, items: pairs.length, kappa, exact, status };
  });

  const reviewers = [...new Set(rows.map((row) => row.reviewer))].sort();
  if (reviewers.length > 2)
    warnings.push(`${reviewers.length} reviewers found, the rubric plans two per item`);
  return { reviewers, criteria, disagreements, warnings };
}

/** Mean human score per case, prompt version, model and criterion, for the judge calibration. */
export function humanMeans(rows: readonly HumanScore[]): Map<string, Partial<Record<Criterion, number>>> {
  const sums = new Map<string, Partial<Record<Criterion, { total: number; count: number }>>>();
  for (const row of rows) {
    const key = itemKey(row);
    const entry = sums.get(key) ?? {};
    for (const { key: criterion } of CRITERIA) {
      const score = row.scores[criterion];
      if (score === undefined) continue;
      const sum = entry[criterion] ?? { total: 0, count: 0 };
      entry[criterion] = { total: sum.total + score, count: sum.count + 1 };
    }
    sums.set(key, entry);
  }
  const means = new Map<string, Partial<Record<Criterion, number>>>();
  for (const [key, entry] of sums) {
    const mean: Partial<Record<Criterion, number>> = {};
    for (const { key: criterion } of CRITERIA) {
      const sum = entry[criterion];
      if (sum) mean[criterion] = sum.total / sum.count;
    }
    means.set(key, mean);
  }
  return means;
}

export function humanKey(caseId: string, promptVersion: string, model: string): string {
  return `${caseId}|${promptVersion}|${model}`;
}

function format(value: number | null, digits = 2): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

export function renderAgreement(report: AgreementReport): string {
  const lines = [
    `Reviewers: ${report.reviewers.join(", ") || "none"}`,
    "",
    "| Criterion | Items | Kappa | Exact | Status |",
    "| --- | --- | --- | --- | --- |",
    ...report.criteria.map(
      (row) =>
        `| ${row.label} | ${row.items} | ${format(row.kappa)} | ${row.exact === null ? "n/a" : `${Math.round(row.exact * 100)} %`} | ${
          row.status === "ok"
            ? "ok"
            : row.status === "low"
              ? `below ${KAPPA_TARGET}`
              : `fewer than ${MIN_ITEMS} items`
        } |`,
    ),
  ];
  if (report.disagreements.length > 0) {
    lines.push("", "Gaps of 2 points or more, to discuss:");
    for (const item of report.disagreements) {
      const scores = item.scores.map((score) => `${score.reviewer} ${score.score}`).join(", ");
      lines.push(`- ${item.caseId} (${item.promptVersion}, ${item.model}), ${item.criterion}: ${scores}`);
    }
  }
  if (report.warnings.length > 0) lines.push("", ...report.warnings.map((warning) => `Warning: ${warning}`));
  return lines.join("\n");
}

/**
 * `agreement [file.csv ...]`. Exit code 0 when every criterion with enough
 * items reaches the target, 1 when one is below it, 2 when a sheet is invalid.
 */
export function agreementCli(paths: readonly string[], log: (line: string) => void = console.log): number {
  const parsed: ParsedScores = { rows: [], errors: [] };
  if (paths.length === 0) {
    const all = loadHumanScores();
    parsed.rows.push(...all.rows);
    parsed.errors.push(...all.errors);
  } else {
    for (const path of paths) {
      const one = parseHumanScores(readFileSync(path, "utf8"), path);
      parsed.rows.push(...one.rows);
      parsed.errors.push(...one.errors);
    }
  }
  if (parsed.errors.length > 0) {
    parsed.errors.forEach((error) => log(error));
    return 2;
  }
  if (parsed.rows.length === 0) {
    log(`No scores found. Copy ${HUMAN_DIR}/${TEMPLATE_FILE} and fill it in.`);
    return 2;
  }
  const report = agreement(parsed.rows);
  log(renderAgreement(report));
  return report.criteria.some((row) => row.status === "low") ? 1 : 0;
}
