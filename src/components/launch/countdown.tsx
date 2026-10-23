"use client";

import { cn } from "@/lib/utils";
import { useNow } from "./use-now";

const UNITS = ["days", "hours", "minutes", "seconds"] as const;
export type CountdownUnit = (typeof UNITS)[number];

/** Splits a duration into days, hours, minutes and seconds. Never negative. */
export function timeLeft(ms: number): Record<CountdownUnit, number> {
  const s = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(s / 86_400),
    hours: Math.floor(s / 3600) % 24,
    minutes: Math.floor(s / 60) % 60,
    seconds: s % 60,
  };
}

/**
 * Days, hours, minutes and seconds to the launch. The digits show once the
 * page runs in the browser; the server render has dashes in their place. The
 * text comes from the server, so no message goes to the browser for it.
 */
export function Countdown({
  until,
  label,
  units,
  className,
}: {
  until: string;
  label: string;
  units: Record<CountdownUnit, string>;
  className?: string;
}) {
  const now = useNow();
  const left = now === null ? null : timeLeft(Date.parse(until) - now);

  return (
    <div role="timer" aria-label={label} className={cn("grid grid-cols-4 gap-2 sm:gap-3", className)}>
      {UNITS.map((unit) => (
        <div key={unit} className="surface-float rounded-2xl border px-1 py-3 text-center sm:py-4">
          <span className="block text-3xl font-semibold tabular-nums text-foreground sm:text-4xl">
            {left ? String(left[unit]).padStart(2, "0") : "--"}
          </span>
          <span className="mt-1 block text-[11px] text-muted-foreground sm:text-xs">{units[unit]}</span>
        </div>
      ))}
    </div>
  );
}
