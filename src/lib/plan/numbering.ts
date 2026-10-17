// The number in front of a line of a plan: "1.", "1)", "1 -", "2.1",
// "2.1.", "II.", "A.", "a)", "iv)". Numbers have at most three digits, so
// a year at the start of a sentence ("2024. Le projet...") is not one.

export type NumberingFamily =
  | "decimal"
  | "dotted"
  | "upper-roman"
  | "lower-roman"
  | "upper-letter"
  | "lower-letter";

export type Numbering = {
  family: NumberingFamily;
  /** "2.1" gives [2, 1]; "IV" gives [4]; "C" as a letter gives [3]. */
  values: number[];
  /** What follows the number: ".", ")" or "-". Empty for dotted numbers. */
  delimiter: string;
  /** A single letter that is also a Roman numeral (I, V, X, L): its value as one. */
  romanValue: number | null;
  /** The text after the number and its delimiter. */
  rest: string;
};

const DOTTED = /^(\d{1,3}(?:\.\d{1,3}){1,5})\.?\)?(?:\s+[-\u2013\u2014:])?\s+(\S.*)$/s;
const DECIMAL = /^(\d{1,3})(?:([.)])|\s*([-\u2013\u2014]))\s+(\S.*)$/s;
const TOKEN = /^([IVXL]{1,7}|[A-Z]|[ivxl]{1,7}|[a-z])(?:([.)])|\s+([-\u2013\u2014]))\s+(\S.*)$/s;

const ROMAN_DIGITS: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 };

/** The value of a well-formed Roman numeral up to 89, or null. A plan has fewer parts, and "CV" is a word. */
export function romanValue(token: string): number | null {
  const upper = token.toUpperCase();
  if (!/^(XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(upper) || upper === "") return null;
  let total = 0;
  for (let index = 0; index < upper.length; index++) {
    const value = ROMAN_DIGITS[upper.charAt(index)] ?? 0;
    const next = ROMAN_DIGITS[upper.charAt(index + 1)] ?? 0;
    total += value < next ? -value : value;
  }
  return total;
}

/** The number in front of a line (leading spaces already removed), or null. */
export function parseNumbering(line: string): Numbering | null {
  const dotted = DOTTED.exec(line);
  if (dotted?.[1] && dotted[2]) {
    return {
      family: "dotted",
      values: dotted[1].split(".").map(Number),
      delimiter: "",
      romanValue: null,
      rest: dotted[2],
    };
  }
  const decimal = DECIMAL.exec(line);
  if (decimal?.[1] && decimal[4]) {
    return {
      family: "decimal",
      values: [Number(decimal[1])],
      delimiter: decimal[2] ?? "-",
      romanValue: null,
      rest: decimal[4],
    };
  }
  const token = TOKEN.exec(line);
  if (!token?.[1] || !token[4]) return null;
  const value = token[1];
  const delimiter = token[2] ?? "-";
  const upper = value === value.toUpperCase();
  const roman = romanValue(value);
  if (value.length > 1) {
    if (roman === null) return null;
    return {
      family: upper ? "upper-roman" : "lower-roman",
      values: [roman],
      delimiter,
      romanValue: roman,
      rest: token[4],
    };
  }
  return {
    family: upper ? "upper-letter" : "lower-letter",
    values: [value.toLowerCase().charCodeAt(0) - 96],
    delimiter,
    romanValue: roman,
    rest: token[4],
  };
}

/** The title without the number in front of it, which the app adds itself. */
export function stripLeadingNumber(title: string): string {
  return parseNumbering(title)?.rest ?? title;
}
