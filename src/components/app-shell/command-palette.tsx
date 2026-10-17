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
import { SECTION_STATUSES } from "@/lib/section-statuses";
import { cn } from "@/lib/utils";
import { selectWorkspace } from "@/lib/workspaces/actions";
import { groupByOrganization } from "@/lib/workspaces/group";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { WorkspaceMark } from "./workspace-switcher";

// Other words people search with, so "a faire" or "deconnexion" match. The
// search itself ignores accents and case (components/ui/command.tsx).
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

/** "workspaces": opened from the workspace switcher, it lists only the workspaces, by organization (KRB-206). */
export type PaletteScope = "all" | "workspaces";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: PaletteScope;
  workspaces: MyWorkspace[];
  currentWorkspaceId: string | null;
};

export function CommandPalette({
  open,
  onOpenChange,
  scope,
  workspaces,
  currentWorkspaceId,
}: CommandPaletteProps) {
  const t = useTranslations("CommandPalette");
  const tWorkspaces = useTranslations("Workspaces");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { choice: themeChoice, setTheme } = useThemeChoice();
  const unnamed = tWorkspaces("noOrganizationName");
  const groups = groupByOrganization(workspaces, unnamed);
  const texts = scope === "workspaces" ? ("workspaceSearch." as const) : ("" as const);

  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  function workspaceItem(workspace: MyWorkspace, organizationName: string, showOrganization: boolean) {
    return (
      <CommandItem
        key={workspace.id}
        // Unique for cmdk. The search reads the names from keywords.
        value={`espace ${workspace.id}`}
        keywords={[workspace.name, organizationName]}
        onSelect={() => run(() => startTransition(() => selectWorkspace(workspace.id)))}
      >
        <WorkspaceMark name={workspace.name} className="size-6 rounded-md text-[10px]" />
        <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
        {showOrganization ? (
          <span className="max-w-[45%] truncate text-xs text-muted-foreground">{organizationName}</span>
        ) : null}
        {workspace.id === currentWorkspaceId ? (
          <span className="flex items-center">
            <Check aria-hidden="true" />
            <span className="sr-only">{t("currentWorkspace")}</span>
          </span>
        ) : null}
      </CommandItem>
    );
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(`${texts}title`)}
      description={t(`${texts}description`)}
      label={t(`${texts}inputLabel`)}
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
      <CommandInput placeholder={t(`${texts}placeholder`)} />
      {/* cmdk names the list "Suggestions" in English by default. */}
      <CommandList label={t(`${texts}listLabel`)}>
        <CommandEmpty>{t(`${texts}empty`)}</CommandEmpty>
        {scope === "workspaces" ? (
          groups.map((group) => {
            const organizationName = group.organizationName ?? unnamed;
            return (
              <CommandGroup key={group.organizationId} heading={organizationName}>
                {group.workspaces.map((workspace) => workspaceItem(workspace, organizationName, false))}
              </CommandGroup>
            );
          })
        ) : (
          <>
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
            {/* Switching makes sense from two workspaces on. */}
            {workspaces.length > 1 ? (
              <CommandGroup heading={t("workspaces")}>
                {groups.flatMap((group) =>
                  group.workspaces.map((workspace) =>
                    workspaceItem(workspace, group.organizationName ?? unnamed, true),
                  ),
                )}
              </CommandGroup>
            ) : null}
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
          </>
        )}
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
