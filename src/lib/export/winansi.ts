// The PDF uses the standard Helvetica and Courier fonts, which every reader
// has, so no font file ships with the app. They only draw the WinAnsi
// characters: Latin-1 plus a few more such as œ, Œ, €, the curly quotes and
// the dashes. That covers French, « » included. Anything else is mapped to
// its nearest WinAnsi form when there is one (narrow no-break space,
// ligatures, accents of other languages) or drawn as "?", because pdfkit
// would otherwise write a code the font doesn't have.

// What WinAnsi puts in 0x80 to 0x9f, where Latin-1 has control characters.
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e,
  0x0178,
]);

// Printable Latin-1 and line breaks: the text is cleaned before.
const PLAIN = /^[\n\u0020-\u007e\u00a0-\u00ff]*$/;

const REPLACEMENTS: Record<string, string> = {
  "\u2002": " ",
  "\u2003": " ",
  "\u2004": " ",
  "\u2005": " ",
  "\u2006": " ",
  "\u2007": "\u00a0",
  "\u2008": " ",
  "\u2009": " ",
  "\u200a": " ",
  "\u202f": "\u00a0",
  "\u205f": " ",
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "\u2013",
  "\u2015": "\u2014",
  "\u2212": "-",
  "\u2032": "'",
  "\u2033": '"',
  "\u201b": "'",
  "\u201f": '"',
  "\u02bc": "\u2019",
  "\u2028": " ",
  "\u2029": " ",
  "\u2043": "-",
  "\u2044": "/",
  "\u2190": "<-",
  "\u2192": "->",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u2260": "!=",
  "\u2248": "~",
  "\u2713": "v",
  "\u2714": "v",
};

const ZERO_WIDTH = /^[\u200b-\u200f\u2060-\u2064\ufeff\p{M}]$/u;

function isWinAnsi(char: string): boolean {
  return PLAIN.test(char) || WIN_ANSI_EXTRA.has(char.codePointAt(0) ?? 0);
}

const cache = new Map<string, string>();

function winAnsiChar(char: string): string {
  if (isWinAnsi(char)) return char;
  let mapped = cache.get(char);
  if (mapped !== undefined) return mapped;
  mapped = REPLACEMENTS[char];
  if (mapped === undefined) {
    if (ZERO_WIDTH.test(char)) {
      mapped = "";
    } else {
      const decomposed = char.normalize("NFKD").replace(/\p{M}/gu, "");
      mapped = decomposed && [...decomposed].every(isWinAnsi) ? decomposed : "?";
    }
  }
  if (cache.size < 10_000) cache.set(char, mapped);
  return mapped;
}

/** Text the standard PDF fonts can draw, one "?" for each character they can't. */
export function toWinAnsi(text: string): string {
  if (PLAIN.test(text)) return text;
  let result = "";
  for (const char of text.normalize("NFC")) result += winAnsiChar(char);
  return result;
}
