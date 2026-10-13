import { cn } from "@/lib/utils";

/** Placeholder block shown while data loads. A light sweep runs unless reduced motion is on. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden rounded-md bg-muted",
        "before:absolute before:inset-0 before:-translate-x-full before:bg-gradient-to-r before:from-transparent before:via-white/70 before:to-transparent motion-safe:before:animate-shimmer dark:before:via-white/5",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
