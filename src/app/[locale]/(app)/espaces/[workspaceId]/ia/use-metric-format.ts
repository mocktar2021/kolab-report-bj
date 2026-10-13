import { useFormatter } from "next-intl";

/** French formatting of the dashboard figures. Each one returns null for a missing value. */
export function useMetricFormat() {
  const format = useFormatter();

  return {
    count: (value: number) => format.number(value),
    percent: (value: number | null) =>
      value === null ? null : format.number(value, { style: "percent", maximumFractionDigits: 1 }),
    /** USD, with four decimals under one dollar so that small costs don't read as zero. */
    cost: (value: number | null) =>
      value === null
        ? null
        : format.number(value, {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 2,
            maximumFractionDigits: Math.abs(value) < 1 ? 4 : 2,
          }),
    /** Milliseconds shown in seconds, one decimal. */
    seconds: (ms: number | null) =>
      ms === null
        ? null
        : format.number(ms / 1000, {
            style: "unit",
            unit: "second",
            unitDisplay: "short",
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }),
  };
}
