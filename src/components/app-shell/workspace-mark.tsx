import { cn } from "@/lib/utils";
import { initialsOf } from "./user-avatar";

/** Square with the workspace initials: switcher, command palette and reports of an organization. */
export function WorkspaceMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        // A light tint keeps the coral initials at 4.5:1, even on the hover background.
        "flex size-8 shrink-0 items-center justify-center rounded-lg bg-highlight/[0.08] text-[11px] font-semibold text-highlight ring-1 ring-inset ring-highlight/25",
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
