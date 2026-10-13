// Masks personal data in text sent to the model, when AI_REDACT_PII is on.
// Every pattern has a bounded length and starts at a word or digit boundary,
// so each position costs a fixed amount of work and a long text stays linear.
// Numbers with a check digit (cards, IBANs) are only masked when the check
// passes, so ordinary figures in tables survive.

export type PiiKind = "email" | "phone" | "iban" | "nir" | "card";

export const PII_PLACEHOLDERS: Record<PiiKind, string> = {
  email: "[e-mail masqué]",
  phone: "[téléphone masqué]",
  iban: "[IBAN masqué]",
  nir: "[n° de sécurité sociale masqué]",
  card: "[n° de carte masqué]",
};

const EMAIL =
  /(?<![\p{L}\p{N}._%+\\-])[A-Za-z0-9._%+\\-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/gu;

// Uppercase only: two letters, two check digits, then up to 30 letters or
// digits in groups of four. The checksum decides.
const IBAN =
  /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?:[  ]?[A-Z0-9]{4}){2,7}(?:[  ]?[A-Z0-9]{1,4})?(?![\p{L}\p{N}])/gu;

// 1 or 2, year, month (01 to 12, or 20 to 99 when unknown), department
// (2A and 2B for Corsica, three digits overseas), commune, order, key.
const NIR =
  /(?<![\p{L}\p{N}])[12][   ]?\d{2}[   ]?(?:0[1-9]|1[0-2]|[2-9]\d)[   ]?(?:(?:\d{2}|2[ABab])[   ]?\d{3}|9[78]\d[   ]?\d{2})[   ]?\d{3}[   ]?\d{2}(?![\p{L}\p{N}])/gu;

// 13 to 19 digits in one run, or printed in groups: 4-4-4-4 (plus up to 3)
// and 4-6-4 or 4-6-5.
const CARD =
  /(?<![\p{L}\p{N}])(?:\d{13,19}|\d{4}([  -])\d{4}\1\d{4}\1\d{4}(?:\1\d{1,3})?|\d{4}([  -])\d{6}\2\d{4,5})(?![\p{L}\p{N}])/gu;

// Benin: +229, then 01 for the ten-digit numbers in use since 2024, then
// eight digits. Runs before the French pattern so the prefix goes too.
const PHONE_BJ = /(?<![\d+])(?:\+|00)229[ .  -]?(?:01[ .  -]?)?\d{2}(?:[ .  -]?\d{2}){3}(?!\d)/gu;

// France: 0X or +33 X (with an optional "(0)"), then four pairs of digits.
// The separator between pairs must stay the same, so a date followed by
// a number does not read as a phone number.
const PHONE_FR =
  /(?<![\d+])(?:(?:\+|00)33[ .  -]?(?:\(0\)[ .  -]?)?|0)[1-9]([ .  -]?)\d{2}(?:\1\d{2}){3}(?!\d)/gu;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = digits.charCodeAt(index) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function isCard(match: string): boolean {
  const digits = match.replace(/\D/g, "");
  // 14 digits in one run is the shape of a SIRET, which passes Luhn too.
  if (digits.length === 14 && digits === match) return false;
  // No card network starts with 19 or 20, years in a row often do.
  if (digits.startsWith("19") || digits.startsWith("20")) return false;
  return luhnValid(digits);
}

function ibanValid(candidate: string): boolean {
  const compact = candidate.replace(/[  ]/g, "");
  if (compact.length < 15 || compact.length > 34) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    if (code >= 65) remainder = (remainder * 100 + code - 55) % 97;
    else remainder = (remainder * 10 + code - 48) % 97;
  }
  return remainder === 1;
}

/** Masks the longest valid IBAN at the start of the match. A word glued after it is kept. */
function maskIban(match: string): string | null {
  let candidate = match;
  for (;;) {
    if (ibanValid(candidate)) return PII_PLACEHOLDERS.iban + match.slice(candidate.length);
    const separator = Math.max(candidate.lastIndexOf(" "), candidate.lastIndexOf(" "));
    if (separator < 0) return null;
    candidate = candidate.slice(0, separator);
  }
}

export function redactPii(text: string): { text: string; counts: Record<PiiKind, number> } {
  const counts: Record<PiiKind, number> = { email: 0, phone: 0, iban: 0, nir: 0, card: 0 };
  const mask = (kind: PiiKind) => () => {
    counts[kind]++;
    return PII_PLACEHOLDERS[kind];
  };
  const redacted = text
    .replace(EMAIL, mask("email"))
    .replace(IBAN, (match) => {
      const masked = maskIban(match);
      if (masked === null) return match;
      counts.iban++;
      return masked;
    })
    .replace(NIR, mask("nir"))
    .replace(CARD, (match) => (isCard(match) ? mask("card")() : match))
    .replace(PHONE_BJ, mask("phone"))
    .replace(PHONE_FR, mask("phone"));
  return { text: redacted, counts };
}
