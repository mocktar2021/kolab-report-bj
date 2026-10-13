import { cn } from "@/lib/utils";

/** Up to two initials from a name or an e-mail address. */
export function initialsOf(nameOrEmail: string) {
  const base = nameOrEmail.split("@")[0] ?? nameOrEmail;
  const words = base.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : base.slice(0, 2);
  return letters.toUpperCase();
}

type UserAvatarProps = {
  name: string;
  className?: string;
};

export function UserAvatar({ name, className }: UserAvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background",
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
