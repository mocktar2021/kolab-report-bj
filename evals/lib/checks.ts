import type { GoldenCase } from "./case";
import { containsTerm, countWords, languageScore, looksFrench, normalize, type LanguageScore } from "./text";

// Checks that need no model: they run on the generated Markdown, and on each
// reference section in the tests to prove the case itself is consistent.

export type DeterministicChecks = {
  words: number;
  lengthOk: boolean;
  keyPoints: { id: string; covered: boolean }[];
  /** Share of key points covered, 0 to 1. */
  keyPointCoverage: number;
  /** Forbidden strings found in the text. */
  forbiddenFound: string[];
  /** Every cited ref was sent with the request. Null for a reference section, which cites file names. */
  citationValid: boolean | null;
  invalidRefs: string[];
  /** Share of mustCite refs the output cites. Null for a reference section. */
  mustCiteCoverage: number | null;
  missingCites: string[];
  /** No HTML tag, no image, no link that isn't in the deliverables. */
  safeMarkdown: boolean;
  unsafe: string[];
  language: LanguageScore;
  french: boolean;
  /** Marks of machine-written French found in the text: long or spaced dashes, STOCK_PHRASES. */
  styleTells: string[];
};

export type CheckInput = {
  /** The Markdown a reader would get: draftToMarkdown for an output. */
  markdown: string;
  /** Every string of the raw output, to find refs typed in the text. Omit for a reference section. */
  outputText?: string;
  /** Refs the output cites in its structured fields. Omit for a reference section. */
  cited?: readonly string[];
  /** Refs sent with the request. */
  refs: readonly string[];
  /** The deliverables' Markdown, to tell a copied link from an added one. */
  sourceText: string;
  reference: GoldenCase["reference"];
};

// check-prose: off (the list below quotes the patterns it looks for)
/**
 * What makes a French report read as written by a machine (KRB-224): a long
 * dash, or a spaced middle dash, where French puts a comma, a colon or
 * brackets, and set phrases that say nothing. A term ending in "*" matches
 * its forms ("crucia*": crucial, cruciale, cruciaux).
 */
const STYLE_DASHES: readonly { label: string; pattern: RegExp }[] = [
  { label: "tiret long (\u2014)", pattern: /\u2014/ },
  { label: "tiret moyen entre deux espaces (\u2013)", pattern: /\s\u2013\s/ },
];

export const STOCK_PHRASES: readonly string[] = [
  "il est important de noter",
  "il est important de souligner",
  "il est essentiel de",
  "il convient de noter",
  "il convient de souligner",
  "force est de constater",
  "en somme,",
  "en définitive,",
  "crucia*",
  "incontournable*",
  "de manière optimale",
  "n'hésitez pas",
  "plongeons",
];
// check-prose: on

/** The long or spaced dashes and the STOCK_PHRASES found in a text. */
export function styleTells(markdown: string): string[] {
  const text = normalize(markdown);
  return [
    ...STYLE_DASHES.filter(({ pattern }) => pattern.test(markdown)).map(({ label }) => label),
    ...STOCK_PHRASES.filter((phrase) => containsTerm(text, phrase)),
  ];
}

const HTML_TAG = /<\/?[a-z][\w:-]*(?:\s[^<>]*)?\/?>/gi;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const MARKDOWN_LINK = /(?<!!)\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g;
const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s<>()[\]"'`]+/gi;
const TYPED_REF = /(?<![\p{L}\p{N}])L(\d{1,3})(?![\p{L}\p{N}])/gu;

function trimUrl(url: string): string {
  return url.replace(/[.,;:!?»"')\]]+$/, "");
}

/** HTML tags, images and links not present in the deliverables. */
export function unsafeMarkdown(markdown: string, sourceText: string): string[] {
  const found = new Set<string>();
  const source = sourceText.toLowerCase();
  for (const match of markdown.matchAll(HTML_TAG)) found.add(match[0]);
  for (const match of markdown.matchAll(IMAGE)) found.add(match[0]);
  const urls = [
    ...[...markdown.matchAll(MARKDOWN_LINK)].map((match) => match[1] ?? ""),
    ...[...markdown.matchAll(BARE_URL)].map((match) => match[0]),
  ];
  for (const url of urls.map(trimUrl).filter(Boolean)) {
    if (!source.includes(url.toLowerCase())) found.add(url);
  }
  return [...found];
}

/** Refs like L4 typed in the text of an output. */
export function typedRefs(text: string): string[] {
  return [...new Set([...text.matchAll(TYPED_REF)].map((match) => `L${match[1]}`))];
}

export function runChecks(input: CheckInput): DeterministicChecks {
  const { reference } = input;
  const text = normalize(input.markdown);
  const words = countWords(input.markdown);

  const keyPoints = reference.keyPoints.map((point) => ({
    id: point.id,
    covered: point.anyOf.every((group) => group.some((term) => containsTerm(text, term))),
  }));
  const covered = keyPoints.filter((point) => point.covered).length;

  // Forbidden strings are searched in the raw output too, so a canary
  // hidden in a field draftToMarkdown leaves out still counts.
  const forbiddenText = input.outputText === undefined ? text : `${text}\n${normalize(input.outputText)}`;
  const forbiddenFound = reference.forbidden.filter((term) => containsTerm(forbiddenText, term));

  let citationValid: boolean | null = null;
  let invalidRefs: string[] = [];
  let mustCiteCoverage: number | null = null;
  let missingCites: string[] = [];
  if (input.cited !== undefined) {
    const available = new Set(input.refs);
    const all = [...new Set([...input.cited, ...typedRefs(input.outputText ?? input.markdown)])];
    invalidRefs = all.filter((ref) => !available.has(ref));
    citationValid = invalidRefs.length === 0;
    const cited = new Set(input.cited);
    missingCites = reference.mustCite.filter((ref) => !cited.has(ref));
    mustCiteCoverage =
      reference.mustCite.length === 0
        ? 1
        : (reference.mustCite.length - missingCites.length) / reference.mustCite.length;
  }

  const unsafe = unsafeMarkdown(input.markdown, input.sourceText);
  const language = languageScore(input.markdown);

  return {
    words,
    lengthOk: words >= reference.words.min && words <= reference.words.max,
    keyPoints,
    keyPointCoverage: keyPoints.length === 0 ? 1 : covered / keyPoints.length,
    forbiddenFound,
    citationValid,
    invalidRefs,
    mustCiteCoverage,
    missingCites,
    safeMarkdown: unsafe.length === 0,
    unsafe,
    language,
    french: looksFrench(language),
    styleTells: styleTells(input.markdown),
  };
}

/** Every string in a value, joined: the text of a structured output. */
export function allStrings(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(allStrings).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(allStrings).join("\n");
  return "";
}
