import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Styled native <select>. The browser handles the keyboard, screen readers
 * and the mobile picker, which suits short lists like roles or experts.
 */
type NativeSelectProps = React.ComponentProps<"select"> & {
  /** Classes for the <select> itself, for example h-10 next to a text input. */
  selectClassName?: string;
};

const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, selectClassName, children, ...props }, ref) => (
    <span className={cn("relative block", className)}>
      <select
        ref={ref}
        className={cn(
          "flex h-9 w-full appearance-none rounded-lg border border-input bg-card py-1.5 pl-3 pr-9 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50",
          selectClassName,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  ),
);
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
