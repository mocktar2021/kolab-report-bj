import { z } from "zod";
import { OUTPUT_SCHEMAS, PROMPT_LIMITS, type OutputSchema } from "./catalog";

// "Décrire le modèle" (KRB-198): a short form whose answers become a
// template text, without the AI. The text follows the style of the global
// templates (supabase/migrations/20261013210100_global_prompt_templates.sql)
// and uses the same variables. What the manager types is copied in as
// written, except double braces, which are split so their text can never
// become a placeholder. The editor opens on the result, to read and change
// before saving.

export const BUILDER_TONES = ["professionnel", "pedagogique", "synthetique", "institutionnel"] as const;
export type BuilderTone = (typeof BUILDER_TONES)[number];

export const BUILDER_LENGTHS = ["courte", "moyenne", "longue"] as const;
export type BuilderLength = (typeof BUILDER_LENGTHS)[number];

/** What the AI does when the deliverables lack something. */
export const BUILDER_MISSING = ["signaler", "a_completer", "lister"] as const;
export type BuilderMissing = (typeof BUILDER_MISSING)[number];

export const BUILDER_LIMITS = {
  contentMin: 10,
  contentMax: 1500,
  headingsMax: 12,
  headingMax: 120,
  /** Longest description the builder derives from the expected content. */
  descriptionMax: 200,
} as const;

export type BuilderAnswers = {
  title: string;
  outputSchema: OutputSchema;
  /** What the section must contain, in the manager's words. */
  content: string;
  /** Expected headings, one per line. Empty: the AI chooses. */
  headings: string;
  tone: BuilderTone;
  length: BuilderLength;
  missing: BuilderMissing;
};

export const DEFAULT_BUILDER_ANSWERS: BuilderAnswers = {
  title: "",
  outputSchema: "section_draft",
  content: "",
  headings: "",
  tone: "professionnel",
  length: "moyenne",
  missing: "signaler",
};

/** Keys under Prompts.builder.errors in messages/fr.json. */
export type BuilderErrorKey =
  | "titleLength"
  | "contentLength"
  | "headingsTooMany"
  | "headingLength"
  | "invalidChoice";

/** Characters as Postgres counts them: an emoji is one, not two. */
const characters = (value: string) => [...value].length;

/** The headings typed in the form, one per line, without list marks or empty lines. */
export function headingLines(headings: string): string[] {
  return headings
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

export const builderAnswersSchema = z.object({
  title: z
    .string()
    .transform(cleanLine)
    .refine(
      (value) => characters(value) >= PROMPT_LIMITS.titleMin && characters(value) <= PROMPT_LIMITS.titleMax,
      "titleLength",
    ),
  outputSchema: z.enum(OUTPUT_SCHEMAS, { message: "invalidChoice" }),
  content: z
    .string()
    .transform(neutralizeText)
    .refine(
      (value) =>
        characters(value) >= BUILDER_LIMITS.contentMin && characters(value) <= BUILDER_LIMITS.contentMax,
      "contentLength",
    ),
  headings: z
    .string()
    .refine((value) => headingLines(value).length <= BUILDER_LIMITS.headingsMax, "headingsTooMany")
    .refine(
      (value) => headingLines(value).every((line) => characters(line) <= BUILDER_LIMITS.headingMax),
      "headingLength",
    ),
  tone: z.enum(BUILDER_TONES, { message: "invalidChoice" }),
  length: z.enum(BUILDER_LENGTHS, { message: "invalidChoice" }),
  missing: z.enum(BUILDER_MISSING, { message: "invalidChoice" }),
});

/** First error key per field. */
export function builderFieldErrors(
  error: z.ZodError,
): Partial<Record<keyof BuilderAnswers, BuilderErrorKey>> {
  const errors: Partial<Record<keyof BuilderAnswers, BuilderErrorKey>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as keyof BuilderAnswers | undefined;
    if (field && !errors[field]) errors[field] = issue.message as BuilderErrorKey;
  }
  return errors;
}

/**
 * String.prototype.toWellFormed, with a fallback: this file also runs in the
 * browser, and Safari only has it from 16.4 (iOS 15 devices never get it).
 * Each lone surrogate becomes U+FFFD, as the native method does.
 */
export function wellFormed(text: string): string {
  if (typeof text.toWellFormed === "function") return text.toWellFormed();
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const next = text.charCodeAt(i + 1);
    if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      out += text.slice(i, i + 2);
      i++;
    } else {
      out += code >= 0xd800 && code <= 0xdfff ? "\ufffd" : text.charAt(i);
    }
  }
  return out;
}

/**
 * Text typed by the manager, made safe to put in a template: no control
 * characters (NUL included, which Postgres refuses), Unix line ends, at most
 * one empty line in a row, and no "{{" or "}}": a space goes between two
 * braces, so "{{client}}" stays readable but is not a variable.
 */
export function neutralizeText(text: string): string {
  return (
    wellFormed(text)
      .replace(/\r\n?/g, "\n")
      // Control characters other than tab and line feed, and invisible format characters.
      .replace(/(?![\t\n])\p{Cc}|\p{Cf}/gu, "")
      .replace(/\{(?=\{)/g, "{ ")
      .replace(/\}(?=\})/g, "} ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** One line of text, such as a title: cleaned like neutralizeText, with every run of blanks as one space. */
export function cleanLine(text: string): string {
  return wellFormed(text)
    .replace(/(?![\t\n])\p{Cc}|\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const OPENINGS: Record<OutputSchema, string> = {
  section_draft: "Tu rédiges une section d'un rapport d'expertise, en français.",
  executive_summary: "Tu rédiges le résumé exécutif d'un rapport d'expertise, en français.",
  recommendations: "Tu formules les recommandations d'un rapport d'expertise, en français.",
  data_analysis: "Tu analyses les données chiffrées d'une section d'un rapport d'expertise, en français.",
};

/** What each type of result needs on top of the shared rules, as in the global templates. */
const SCHEMA_RULES: Record<OutputSchema, string | null> = {
  section_draft: null,
  executive_summary: "Termine par trois à cinq points clés, d'une phrase chacun.",
  recommendations:
    "Pour chaque recommandation, donne le constat qui la justifie, le livrable d'où il vient et une priorité (haute, moyenne ou basse).",
  data_analysis:
    "Reprends les chiffres exactement comme ils figurent dans les tableaux, avec leur unité, et termine par les limites des données.",
};

const TONES: Record<BuilderTone, string> = {
  professionnel: "Garde un ton professionnel et précis, sans formules creuses.",
  pedagogique:
    "Écris pour un lecteur qui n'est pas spécialiste : explique les termes techniques et dis ce que chaque constat implique.",
  synthetique: "Va à l'essentiel : des phrases courtes, une idée par phrase, sans répétition.",
  institutionnel:
    "Adopte un ton formel et institutionnel, celui d'un rapport remis à une administration ou à un bailleur.",
};

const LENGTHS: Record<BuilderLength, string> = {
  courte: "Vise environ 300 mots.",
  moyenne: "Vise environ 600 mots.",
  longue: "Vise environ 1 200 mots.",
};

const MISSING: Record<BuilderMissing, string> = {
  signaler:
    "Quand une information manque dans les livrables, dis-le clairement à l'endroit concerné, sans la deviner.",
  a_completer:
    "Quand une information manque dans les livrables, écris « [À compléter : ce qui manque] » à l'endroit concerné, sans la deviner.",
  lister:
    "Quand une information manque dans les livrables, ne la devine pas : termine par une liste « Points à compléter » qui dit ce qui manque et quel livrable l'apporterait.",
};

/** The first line of the expected content, cut at a word, for the template's description. */
function descriptionFrom(content: string): string {
  const firstLine = neutralizeText(content).split("\n")[0]?.trim() ?? "";
  const chars = [...firstLine];
  if (chars.length <= BUILDER_LIMITS.descriptionMax) return firstLine;
  const cut = chars.slice(0, BUILDER_LIMITS.descriptionMax - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

export type BuiltTemplate = {
  title: string;
  description: string;
  template: string;
  outputSchema: OutputSchema;
};

/**
 * The template for a form's answers. Pure and without the AI. Call it on
 * answers that passed builderAnswersSchema: the result then passes
 * checkTemplate and promptVersionSchema.
 */
export function buildTemplate(answers: BuilderAnswers): BuiltTemplate {
  const headings = headingLines(answers.headings).map(neutralizeText).filter(Boolean);
  const structure =
    headings.length > 0
      ? `Organise ta réponse avec ces intertitres, dans cet ordre :\n${headings.map((line) => `- ${line}`).join("\n")}`
      : "Organise ta réponse avec des intertitres si le contenu le demande.";
  const rules = [
    TONES[answers.tone],
    LENGTHS[answers.length],
    "Appuie chaque constat sur les livrables et cite le fichier d'où il vient.",
    SCHEMA_RULES[answers.outputSchema],
    "N'invente aucun chiffre, aucune date ni aucun nom qui ne figure pas dans les livrables.",
    MISSING[answers.missing],
  ].filter((rule): rule is string => rule !== null);

  const template = [
    OPENINGS[answers.outputSchema],
    [
      "Rapport : {{report_title}}",
      "Contexte du rapport : {{report_context}}",
      "Section à rédiger : {{section_title}}",
      "Consignes de la section : {{section_instructions}}",
    ].join("\n"),
    "Livrables fournis par l'équipe :\n{{deliverables}}",
    `Contenu attendu :\n${neutralizeText(answers.content)}`,
    structure,
    rules.join("\n"),
  ].join("\n\n");

  return {
    title: cleanLine(answers.title),
    description: descriptionFrom(answers.content),
    template,
    outputSchema: answers.outputSchema,
  };
}
