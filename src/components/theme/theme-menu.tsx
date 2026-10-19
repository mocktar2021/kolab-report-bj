"use client";

import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLazyMenuFocus, type LazyMenuProps } from "@/components/ui/lazy-menu";
import { THEME_CHOICES } from "./theme-config";
import { THEME_ICONS, ThemeButton, useThemeChoice, type ThemeToggleProps } from "./theme-toggle";

/** The theme menu itself, loaded by ThemeToggle when its button is used. */
export function ThemeMenu({
  variant,
  collapsible,
  className,
  align,
  side,
  ...lazy
}: Required<Pick<ThemeToggleProps, "variant" | "collapsible">> &
  Pick<ThemeToggleProps, "className" | "align" | "side"> &
  LazyMenuProps) {
  const t = useTranslations("Theme");
  const { choice, setTheme } = useThemeChoice();
  const button = useLazyMenuFocus(lazy);

  return (
    <DropdownMenu defaultOpen={lazy.defaultOpen}>
      <DropdownMenuTrigger asChild>
        <ThemeButton ref={button} variant={variant} collapsible={collapsible} className={className} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side}>
        <DropdownMenuLabel>{t("label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={choice} onValueChange={setTheme}>
          {THEME_CHOICES.map((option) => {
            const Icon = THEME_ICONS[option];
            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <Icon aria-hidden="true" />
                {t(option)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
