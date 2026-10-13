import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Square mark: three section lines, the middle one still being written. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7 shrink-0", className)}>
      <rect width="32" height="32" rx="9" className="fill-foreground" />
      <path
        d="M10 10.5h12M10 16h6.5M10 21.5h12"
        className="stroke-background"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="21" cy="16" r="1.6" className="fill-background" />
    </svg>
  );
}

type LogoProps = {
  className?: string;
  /** Extra classes for the wordmark, for example to hide it in a collapsed sidebar. */
  wordmarkClassName?: string;
};

export function Logo({ className, wordmarkClassName }: LogoProps) {
  const t = useTranslations("Common");

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span
        className={cn("text-[0.9375rem] font-semibold tracking-[-0.01em] text-foreground", wordmarkClassName)}
      >
        {t("appName")}
      </span>
    </span>
  );
}
