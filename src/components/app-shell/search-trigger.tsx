"use client";

import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePalette } from "./palette";
import { useShortcutModifier } from "./use-shortcut-label";

type SearchTriggerProps = {
  /** Opens the palette of the app shell when not given. */
  onOpen?: () => void;
  /** Hide the label and shortcut when the desktop sidebar is collapsed. */
  collapsible?: boolean;
  className?: string;
};

/** Button that opens the command palette and shows its keyboard shortcut. */
export function SearchTrigger({ onOpen, collapsible = false, className }: SearchTriggerProps) {
  const t = useTranslations("AppShell");
  const modifier = useShortcutModifier();
  const palette = usePalette();

  return (
    <button
      type="button"
      onClick={onOpen ?? (() => palette?.open("all"))}
      aria-keyshortcuts="Meta+K Control+K"
      className={cn(
        "group flex h-9 w-full items-center gap-2.5 rounded-lg border bg-background/70 px-2.5 text-sm text-muted-foreground shadow-sm outline-none transition-[color,border-color,box-shadow] hover:border-foreground/20 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        collapsible && "sidebar-collapsed:justify-center sidebar-collapsed:px-0",
        className,
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <span className={cn("truncate", collapsible && "sidebar-collapsed:sr-only")}>{t("search")}</span>
      <kbd
        aria-hidden="true"
        className={cn(
          "ml-auto inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 font-sans text-[11px] font-medium text-muted-foreground",
          collapsible && "sidebar-collapsed:hidden",
        )}
      >
        <span>{modifier}</span>
        <span>K</span>
      </kbd>
    </button>
  );
}

/** The same, as an icon in the top bar below lg. */
export function SearchIconButton({ className }: { className: string }) {
  const t = useTranslations("AppShell");
  const palette = usePalette();

  return (
    <button
      type="button"
      onClick={() => palette?.open("all")}
      aria-label={t("searchLabel")}
      aria-keyshortcuts="Meta+K Control+K"
      className={className}
    >
      <Search className="size-5" aria-hidden="true" />
    </button>
  );
}
