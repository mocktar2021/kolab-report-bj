// Text helpers for the deterministic checks. Matching ignores case, accents,
// the kind of space or apostrophe, how thousands are grouped ("1 250 000",
// "1250000") and the decimal mark ("12,5", "12.5"), so a check doesn't fail
// on how a number was typed.

const LIGATURES: Record<string, string> = { œ: "oe", Œ: "oe", æ: "ae", Æ: "ae" };

/** Lowercase, no accents, plain spaces and apostrophes, numbers written one way. */
export function normalize(text: string): string {
  return (
    text
      .replace(/[œŒæÆ]/g, (letter) => LIGATURES[letter] ?? letter)
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[‘’ʼ`´]/g, "'")
      .replace(/[    ]/g, " ")
      // Markdown escapes from the parsers (\_ \* \|) are not part of the text.
      .replace(/\\([\\`*_[\]~|<>#&.+=-])/g, "$1")
      // "1 250 000" becomes "1250000", but "2023 500" stays two numbers.
      .replace(/(?<![\d.,])\d{1,3}(?: \d{3})+(?!\d)/g, (number) => number.replace(/ /g, ""))
      .replace(/(\d),(\d)/g, "$1.$2")
      .replace(/(\d) +%/g, "$1%")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether the normalized text holds the term as a whole word or phrase.
 * A term ending with "*" matches as a prefix: "recommand*" finds
 * "recommandation" and "recommandons".
 */
export function containsTerm(normalizedText: string, term: string): boolean {
  const prefix = term.endsWith("*");
  const needle = normalize(prefix ? term.slice(0, -1) : term);
  if (!needle) return false;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}${prefix ? "" : "(?![\\p{L}\\p{N}])"}`,
    "u",
  );
  return pattern.test(normalizedText);
}

/** Words as the parsers count them: runs of letters and digits. */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

// Frequent words that are clearly French or clearly English. Words both
// languages use ("a", "on") stay out of the lists. Accents are removed, like
// normalize() does.
const FRENCH = new Set(
  (
    "le la les l un une des du de d et en au aux pour par sur dans avec sans ce cette ces cet qui que qu " +
    "est sont ont il elle ils elles nous vous leur leurs se sa son ses pas ne n plus ou mais donc car " +
    "comme ete etre fait aussi tres entre dont selon apres avant chaque tout tous toute toutes y s"
  ).split(" "),
);

const ENGLISH = new Set(
  (
    "the of and to in is are for with that this be by as at from it an or was were which not have has " +
    "will would should can could these those their there been its into than then they we you"
  ).split(" "),
);

export type LanguageScore = { words: number; frenchShare: number; englishShare: number };

/** Share of words that are common French and common English function words. */
export function languageScore(text: string): LanguageScore {
  const words = normalize(text).match(/\p{L}+/gu) ?? [];
  if (words.length === 0) return { words: 0, frenchShare: 0, englishShare: 0 };
  let french = 0;
  let english = 0;
  for (const word of words) {
    if (FRENCH.has(word)) french++;
    if (ENGLISH.has(word)) english++;
  }
  return { words: words.length, frenchShare: french / words.length, englishShare: english / words.length };
}

/** French prose usually has 30 to 45 % of these words. Tables and lists bring it down, so the bar is low. */
export const FRENCH_MIN_SHARE = 0.15;

export function looksFrench(score: LanguageScore): boolean {
  return score.frenchShare >= FRENCH_MIN_SHARE && score.frenchShare > 2 * score.englishShare;
}
