import type { useFormatter } from "next-intl";

type NumberFormatter = Pick<ReturnType<typeof useFormatter>, "number">;

/** "850 o", "140 ko", "1,2 Mo" with the next-intl formatter of the page. */
export function formatFileSize(bytes: number, format: NumberFormatter): string {
  if (bytes < 1024) return format.number(bytes, { style: "unit", unit: "byte", unitDisplay: "short" });
  if (bytes < 1024 * 1024) {
    return format.number(bytes / 1024, {
      style: "unit",
      unit: "kilobyte",
      unitDisplay: "short",
      maximumFractionDigits: 0,
    });
  }
  return format.number(bytes / (1024 * 1024), {
    style: "unit",
    unit: "megabyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  });
}
