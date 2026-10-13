"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, CornerDownLeft, LayoutDashboard, LogOut } from "lucide-react";
import { STATUS_DOT_STYLES } from "@/components/status-badge";
import { THEME_CHOICES } from "@/components/theme/theme-config";
import { THEME_ICONS, useThemeChoice } from "@/components/theme/theme-toggle";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useRouter } from "@/i18n/navigation";
import { signOut } from "@/lib/auth/actions";
import { clearOfflineCaches } from "@/lib/pwa/clear-offline-caches";
import { SECTION_STATUSES } from "@/lib/sections";
import { cn } from "@/lib/utils";

// Extra search terms without accents, so "deconnexion" or "termine" match.
const STATUS_KEYWORDS = {
  not_started: ["non commencees", "a faire", "todo"],
  in_progress: ["en cours", "redaction"],
  completed: ["terminees", "finies", "done"],
} as const;

const THEME_KEYWORDS = {
  light: ["theme clair", "mode clair", "jour", "light"],
  dark: ["theme sombre", "mode sombre", "nuit", "dark"],
  system: ["theme systeme", "appareil", "automatique", "system"],
} as const;

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const t = useTranslations("CommandPalette");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { choice: themeChoice, setTheme } = useThemeChoice();

  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
      footer={
        <div
          aria-hidden="true"
          className="flex items-center gap-4 border-t bg-muted/40 px-4 py-2.5 text-[11px] text-muted-foreground"
        >
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            {t("hintNavigate")}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>
              <CornerDownLeft className="size-3" />
            </Kbd>
            {t("hintSelect")}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <Kbd>Esc</Kbd>
            {t("hintClose")}
          </span>
        </div>
      }
    >
      <CommandInput placeholder={t("placeholder")} />
      <CommandList>
        <CommandEmpty>{t("empty")}</CommandEmpty>
        <CommandGroup heading={t("navigation")}>
          <CommandItem
            value="dashboard"
            keywords={[t("goToDashboard"), "accueil", "tableau de bord"]}
            onSelect={() => run(() => router.push("/tableau-de-bord"))}
          >
            <LayoutDashboard aria-hidden="true" />
            {t("goToDashboard")}
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading={t("filtersHeading")}>
          {SECTION_STATUSES.map((status) => (
            <CommandItem
              key={status}
              value={`filter-${status}`}
              keywords={[t(`filters.${status}`), ...STATUS_KEYWORDS[status]]}
              onSelect={() => run(() => router.push(`/tableau-de-bord?statut=${status}`))}
            >
              <span className="flex size-4 items-center justify-center" aria-hidden="true">
                <span className={cn("size-2 rounded-full", STATUS_DOT_STYLES[status])} />
              </span>
              {t(`filters.${status}`)}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading={t("appearance")}>
          {THEME_CHOICES.map((option) => {
            const Icon = THEME_ICONS[option];
            return (
              <CommandItem
                key={option}
                value={`theme-${option}`}
                keywords={[t(`themes.${option}`), ...THEME_KEYWORDS[option]]}
                onSelect={() => run(() => setTheme(option))}
              >
                <Icon aria-hidden="true" />
                {t(`themes.${option}`)}
                {themeChoice === option ? (
                  <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check aria-hidden="true" />
                    <span className="sr-only">{t("currentTheme")}</span>
                  </span>
                ) : null}
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t("account")}>
          <CommandItem
            value="sign-out"
            keywords={[t("signOut"), "deconnexion", "quitter", "logout"]}
            onSelect={() =>
              run(() => {
                clearOfflineCaches();
                startTransition(() => signOut());
              })
            }
          >
            <LogOut aria-hidden="true" />
            {t("signOut")}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-background px-1 font-sans text-[10px] font-medium">
      {children}
    </kbd>
  );
}
