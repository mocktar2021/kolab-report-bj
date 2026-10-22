"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { useLazyMenu } from "@/components/ui/lazy-menu";
import { cn } from "@/lib/utils";
import { DEFAULT_THEME, isThemeChoice, type ThemeChoice } from "./theme-config";
import { useMounted } from "./use-mounted";

export const THEME_ICONS: Record<ThemeChoice, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

/** The stored choice after hydration, undefined before (the server cannot know it). */
export function useThemeChoice() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const choice: ThemeChoice | undefined = mounted
    ? isThemeChoice(theme)
      ? theme
      : DEFAULT_THEME
    : undefined;
  return { choice, setTheme };
}

/**
 * Sun in the light theme, moon in the dark one. Driven by the html class, so
 * it is right on first paint without waiting for React.
 */
function ResolvedThemeIcon({ className }: { className?: string }) {
  return (
    <>
      <Sun aria-hidden="true" className={cn("size-4 shrink-0 dark:hidden", className)} />
      <Moon aria-hidden="true" className={cn("hidden size-4 shrink-0 dark:block", className)} />
    </>
  );
}

// In the app, the theme is a submenu of the account menu (KRB-227).
export type ThemeToggleProps = {
  className?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
};

/** The round button of the theme menu, before and after the menu loads. */
export function ThemeButton({ className, ...props }: React.ComponentProps<"button">) {
  const t = useTranslations("Theme");
  const { choice } = useThemeChoice();
  const currentLabel = choice ? t(choice) : null;

  return (
    <button
      type="button"
      aria-label={currentLabel ? t("current", { theme: currentLabel }) : t("label")}
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground",
        className,
      )}
      {...props}
    >
      <ResolvedThemeIcon />
    </button>
  );
}

// The menu and Radix load when the button is pointed at or focused (KRB-212).
const loadThemeMenu = () => import("./theme-menu").then((mod) => mod.ThemeMenu);

/** Menu with the Clair, Sombre and Système options. The choice is kept per device. */
export function ThemeToggle({ className, align = "end", side = "bottom" }: ThemeToggleProps) {
  const { Menu, menuProps, placeholderProps } = useLazyMenu(loadThemeMenu);

  return Menu ? (
    <Menu className={className} align={align} side={side} {...menuProps} />
  ) : (
    <ThemeButton className={className} {...placeholderProps} />
  );
}
