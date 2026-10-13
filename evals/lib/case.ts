import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import type { ContextInput } from "@/lib/ai/types";
import { finishMarkdown } from "@/lib/deliverables/parse/markdown";
import { generateContent, generatedSchema } from "./generate";

// One golden case per JSON file in evals/golden/cases. A deliverable's
// Markdown sits in the case (markdown), in a .md file next to it
// (markdownFile, relative to the cases folder), or comes from the long-case
// generator (generated), appended after the other two when both are set.

export const CASES_DIR = "evals/golden/cases";

export const CATEGORIES = ["docx", "xlsx", "mixed", "long", "noisy", "injection"] as const;

export const TEMPLATE_KEYS = [
  "synthese-section",
  "resume-executif",
  "recommandations",
  "analyse-donnees",
] as const;

export type CaseCategory = (typeof CATEGORIES)[number];
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

const ref = z.string().regex(/^L[1-9]\d*$/, "a ref looks like L1, L2...");
const term = z.string().trim().min(1);

const deliverableSchema = z
  .object({
    id: z.string().uuid(),
    fileName: z.string().min(1).max(200),
    kind: z.enum(["document", "spreadsheet", "text"]),
    uploadedAt: z.string().datetime({ offset: true }),
    markdown: z.string().min(1).optional(),
    markdownFile: z
      .string()
      .regex(/^[a-z0-9-]+\/[a-z0-9.-]+\.md$/, "a path like <case-id>/<name>.md")
      .optional(),
    generated: generatedSchema.optional(),
  })
  .strict()
  .refine((value) => !(value.markdown !== undefined && value.markdownFile !== undefined), {
    message: "set markdown or markdownFile, not both",
  })
  .refine((value) => value.markdown ?? value.markdownFile ?? value.generated, {
    message: "a deliverable needs markdown, markdownFile or generated",
  });

export const caseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    category: z.enum(CATEGORIES),
    description: z.string().min(10).max(400),
    template: z.enum(TEMPLATE_KEYS),
    workspaceName: z.string().min(1),
    report: z.object({ title: z.string().min(1), description: z.string().min(1).nullable() }).strict(),
    section: z.object({ title: z.string().min(1), instructions: z.string().min(1).nullable() }).strict(),
    deliverables: z.array(deliverableSchema).min(1).max(20),
    reference: z
      .object({
        markdown: z.string().min(1),
        keyPoints: z
          .array(
            z
              .object({
                id: z.string().regex(/^[a-z0-9-]+$/),
                text: z.string().min(1),
                /** Covered when every group has at least one of its terms in the text. */
                anyOf: z.array(z.array(term).min(1)).min(1),
              })
              .strict(),
          )
          .min(1),
        mustCite: z.array(ref),
        forbidden: z.array(term),
        words: z
          .object({ min: z.number().int().positive(), max: z.number().int().positive() })
          .strict()
          .refine((words) => words.min < words.max, { message: "words.min must be below words.max" }),
      })
      .strict(),
  })
  .strict();

export type GoldenCase = z.infer<typeof caseSchema>;

/** A case with its deliverables read, ready for the context builder. */
export type LoadedCase = GoldenCase & { file: string; input: ContextInput };

/** The Markdown of one deliverable, tidied and capped the way the parsers do it. */
export function deliverableMarkdown(
  deliverable: GoldenCase["deliverables"][number],
  casesDir: string,
): string {
  const parts: string[] = [];
  if (deliverable.markdown !== undefined) parts.push(deliverable.markdown);
  if (deliverable.markdownFile !== undefined)
    parts.push(readFileSync(join(casesDir, deliverable.markdownFile), "utf8"));
  if (deliverable.generated !== undefined) parts.push(generateContent(deliverable.generated));
  return finishMarkdown(parts.join("\n\n"), { kind: deliverable.kind }).markdown;
}

export function toContextInput(value: GoldenCase, casesDir: string): ContextInput {
  return {
    workspaceName: value.workspaceName,
    report: value.report,
    section: value.section,
    deliverables: value.deliverables.map((deliverable) => ({
      id: deliverable.id,
      fileName: deliverable.fileName,
      kind: deliverable.kind,
      uploadedAt: deliverable.uploadedAt,
      markdown: deliverableMarkdown(deliverable, casesDir),
    })),
  };
}

export class CaseError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = "CaseError";
  }
}

/** Reads and checks one case file. Throws a CaseError that names the file. */
export function loadCase(file: string, casesDir: string): LoadedCase {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new CaseError(file, `not valid JSON (${(error as Error).message})`);
  }
  const parsed = caseSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new CaseError(file, issues.join("; "));
  }
  const value = parsed.data;
  if (value.id !== basename(file, ".json"))
    throw new CaseError(file, `id "${value.id}" must match the file name`);
  try {
    return { ...value, file, input: toContextInput(value, casesDir) };
  } catch (error) {
    throw new CaseError(file, (error as Error).message);
  }
}

/** Every case of the golden set, sorted by id. */
export function loadCases(casesDir = resolve(CASES_DIR)): LoadedCase[] {
  const files = readdirSync(casesDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return files.map((name) => loadCase(join(casesDir, name), casesDir));
}

/** The refs the context builder gives the deliverables: by upload date, then id. */
export function expectedRefs(value: GoldenCase): Map<string, string> {
  const ordered = [...value.deliverables].sort(
    (a, b) => Date.parse(a.uploadedAt) - Date.parse(b.uploadedAt) || a.id.localeCompare(b.id),
  );
  return new Map(ordered.map((deliverable, index) => [`L${index + 1}`, deliverable.fileName]));
}
