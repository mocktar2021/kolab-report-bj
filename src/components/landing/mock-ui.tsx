import { cn } from "@/lib/utils";
import type { SectionStatus } from "@/lib/sections";

// Building blocks for the landing illustrations. They are HTML mockups of
// the app, styled with theme tokens so they follow the light and dark themes.
// Every illustration is wrapped in role="img" with a French label, or is
// aria-hidden next to text that says the same thing.

export type SampleSectionKey = "summary" | "context" | "analysis" | "finance" | "recommendations";

type SampleSection = {
  key: SampleSectionKey;
  status: SectionStatus;
  initials: string | null;
  /** Share of the section counted in the report progress (0, 50 or 100). */
  progress: number;
};

// Sample report used by every illustration. 2 completed and 2 in progress
// out of 5 equal-weight sections gives the 60 % shown, with the weights of
// the FAQ answer (completed 100 %, in progress 50 %, not started 0 %).
export const SAMPLE_SECTIONS: SampleSection[] = [
  { key: "summary", status: "completed", initials: "AK", progress: 100 },
  { key: "context", status: "completed", initials: "MB", progress: 100 },
  { key: "analysis", status: "in_progress", initials: "FD", progress: 50 },
  { key: "finance", status: "in_progress", initials: "JT", progress: 50 },
  { key: "recommendations", status: "not_started", initials: null, progress: 0 },
];

export const SAMPLE_PROGRESS = 60;

export const SAMPLE_EXPERTS = ["AK", "MB", "FD", "JT"] as const;

/** Floating card of an illustration. */
export function MockCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("surface-float rounded-2xl border p-4", className)}>{children}</div>;
}

/** Small muted line above or below mockup content. */
export function MockLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("text-[13px] text-muted-foreground", className)}>{children}</p>;
}

const AVATAR_TONES = [
  "bg-foreground text-background",
  "bg-muted text-foreground ring-1 ring-inset ring-border",
  "bg-foreground/70 text-background",
  "bg-secondary text-muted-foreground ring-1 ring-inset ring-border",
];

export function MiniAvatar({
  initials,
  tone = 0,
  className,
}: {
  initials: string;
  tone?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
        AVATAR_TONES[tone % AVATAR_TONES.length],
        className,
      )}
    >
      {initials}
    </span>
  );
}

/** Placeholder for a section nobody has been assigned to yet. */
export function EmptyAvatar({ className }: { className?: string }) {
  return (
    <span
      className={cn("block size-7 shrink-0 rounded-full border border-dashed border-foreground/30", className)}
    />
  );
}

export function AvatarStack({ className, size = "size-8" }: { className?: string; size?: string }) {
  return (
    <span className={cn("flex -space-x-2", className)}>
      {SAMPLE_EXPERTS.map((initials, index) => (
        <MiniAvatar
          key={initials}
          initials={initials}
          tone={index}
          className={cn(size, "ring-2 ring-card")}
        />
      ))}
    </span>
  );
}

/** Ring with a coral stroke for the share done (0 to 100). */
export function ProgressRing({ value, className }: { value: number; className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={cn("size-12 -rotate-90", className)} aria-hidden="true">
      <circle cx="18" cy="18" r="15.5" className="fill-none stroke-foreground/10" strokeWidth="3" />
      <circle
        cx="18"
        cy="18"
        r="15.5"
        pathLength={100}
        strokeDasharray={`${value} 100`}
        strokeLinecap="round"
        className="fill-none stroke-highlight"
        strokeWidth="3"
      />
    </svg>
  );
}

/** Small pill in the coral accent, for badges such as a due date or "IA". */
export function AccentBadge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-highlight/10 px-2.5 py-1 text-[11px] font-medium text-highlight ring-1 ring-inset ring-highlight/25 dark:bg-highlight/15",
        className,
      )}
    >
      {children}
    </span>
  );
}
