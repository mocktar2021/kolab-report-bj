import { EXPORT_TIME_ZONE } from "./labels";
import type { ExportFormat } from "./types";

const MAX_SLUG = 80;

// Letters NFKD leaves whole.
const LETTERS: Record<string, string> = {
  æ: "ae",
  œ: "oe",
  ß: "ss",
  ø: "o",
  đ: "d",
  ð: "d",
  ł: "l",
  þ: "th",
};

const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: EXPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD, the calendar day in Porto-Novo. */
function calendarDay(date: Date): string {
  const parts = Object.fromEntries(DAY_FORMAT.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The title in lowercase ASCII words joined by hyphens, "rapport" when nothing is left. */
function slug(title: string): string {
  const ascii = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[æœßøđðłþ]/g, (letter) => LETTERS[letter] ?? "");
  const words = ascii.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return words.slice(0, MAX_SLUG).replace(/-+$/, "") || "rapport";
}

/** Download name of an export: "{titre}-{YYYY-MM-DD}.docx" or ".pdf". */
export function exportFileName(title: string, date: Date, format: ExportFormat): string {
  return `${slug(title)}-${calendarDay(date)}.${format}`;
}
