import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { SetupError } from "./errors";

// Named lists of case ids for `--subset <name>`. "pr" is the small set the
// pull request workflow runs on every push; the nightly run takes every case.

export const SUBSETS_FILE = "evals/subsets.json";

const caseId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const subsetsSchema = z.record(
  z.string().regex(/^[a-z0-9-]+$/, "a subset name is lowercase words joined by hyphens"),
  z
    .array(caseId)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, { message: "a case id is listed twice" }),
);

export type Subsets = z.infer<typeof subsetsSchema>;

export function loadSubsets(file = resolve(SUBSETS_FILE)): Subsets {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new SetupError(`${SUBSETS_FILE}: ${(error as Error).message}`);
  }
  const parsed = subsetsSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new SetupError(`${SUBSETS_FILE}: ${issues.join("; ")}`);
  }
  return parsed.data;
}

/** The case ids of a subset. Throws when the name or one of its ids is unknown. */
export function subsetIds(name: string, subsets: Subsets, known: ReadonlySet<string>): string[] {
  const ids = Object.hasOwn(subsets, name) ? subsets[name] : undefined;
  if (!ids) {
    const names = Object.keys(subsets);
    throw new SetupError(
      `unknown subset "${name}"${names.length > 0 ? `, known subsets: ${names.join(", ")}` : ""}`,
    );
  }
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0)
    throw new SetupError(`subset "${name}" lists unknown case ids: ${unknown.join(", ")}`);
  return [...ids];
}
