"use client";

import { Fragment, useId, useRef, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  BookText,
  Building2,
  ChevronRight,
  ChevronsUpDown,
  Gauge,
  Plus,
  Search,
  Settings,
  Users,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link } from "@/i18n/navigation";
import { selectWorkspace } from "@/lib/workspaces/actions";
import { groupByOrganization } from "@/lib/workspaces/group";
import { isManager } from "@/lib/workspaces/roles";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { cn } from "@/lib/utils";
import { WorkspaceMark } from "./workspace-mark";

type WorkspaceSwitcherProps = {
  workspaces: MyWorkspace[];
  currentWorkspaceId: string | null;
  /** Hide the text while the desktop sidebar is collapsed. */
  collapsible?: boolean;
  onNavigate?: () => void;
  /** Opens the workspace search of the command palette (KRB-206). */
  onSearch?: () => void;
};

/**
 * Menu to switch the current workspace, open its members, prompt templates or
 * AI dashboard, its settings (owners) and its organization (the organization
 * owner), or create a new one. Workspaces are grouped by organization, and
 * "Rechercher un espace" opens the search of the command palette (KRB-206).
 * Each organization name opens the reports of that organization (KRB-208).
 */
export function WorkspaceSwitcher({
  workspaces,
  currentWorkspaceId,
  collapsible = false,
  onNavigate,
  onSearch,
}: WorkspaceSwitcherProps) {
  const t = useTranslations("Workspaces");
  const tShell = useTranslations("AppShell");
  const [pending, startTransition] = useTransition();
  const labelId = useId();
  const searchChosen = useRef(false);
  const current = workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null;
  const groups = groupByOrganization(workspaces, t("noOrganizationName"));

  if (!current) {
    return (
      <Link
        href="/espaces/nouveau"
        onClick={onNavigate}
        className={cn(
          "flex h-11 w-full items-center gap-3 rounded-lg border border-dashed px-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          collapsible && "sidebar-collapsed:justify-center sidebar-collapsed:px-0",
        )}
      >
        <Plus className="size-4 shrink-0" aria-hidden="true" />
        <span className={cn("truncate", collapsible && "sidebar-collapsed:sr-only")}>{t("create")}</span>
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("switcherLabel", { name: current.name })}
          aria-busy={pending}
          className={cn(
            "flex h-12 w-full items-center gap-3 rounded-lg px-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent",
            collapsible && "sidebar-collapsed:justify-center sidebar-collapsed:px-0",
          )}
        >
          <WorkspaceMark name={current.name} />
          <span className={cn("min-w-0 flex-1", collapsible && "sidebar-collapsed:sr-only")}>
            <span className="block truncate text-sm font-medium text-foreground">{current.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {current.organizationName ?? t(`roles.${current.role}`)}
            </span>
          </span>
          <ChevronsUpDown
            className={cn("size-4 shrink-0 text-muted-foreground", collapsible && "sidebar-collapsed:hidden")}
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 overflow-y-auto"
        onCloseAutoFocus={() => {
          if (!searchChosen.current) return;
          searchChosen.current = false;
          // Once the menu has given the focus back to its button, so the
          // search gives it back there when it closes.
          setTimeout(() => onSearch?.(), 0);
        }}
      >
        {onSearch && workspaces.length > 1 ? (
          <>
            <DropdownMenuItem onSelect={() => (searchChosen.current = true)}>
              <Search aria-hidden="true" />
              {t("searchWorkspaces")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {groups.map((group, index) => {
          const id = `${labelId}-${index}`;
          return (
            <Fragment key={group.organizationId}>
              {/* The organization name opens its reports (KRB-208) and still names its group. */}
              <DropdownMenuItem asChild className="h-8 text-xs font-medium text-muted-foreground">
                <Link
                  href={`/organisations/${group.organizationId}/rapports`}
                  aria-label={t("organizationReportsLabel", {
                    organization: group.organizationName ?? t("noOrganizationName"),
                  })}
                  onClick={onNavigate}
                >
                  <span id={id} className="min-w-0 truncate">
                    {group.organizationName ?? t("noOrganizationName")}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-0.5 font-normal">
                    {t("organizationReports")}
                    <ChevronRight aria-hidden="true" />
                  </span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuRadioGroup
                aria-labelledby={id}
                value={current.id}
                onValueChange={(workspaceId) => {
                  onNavigate?.();
                  startTransition(() => selectWorkspace(workspaceId));
                }}
              >
                {group.workspaces.map((workspace) => (
                  <DropdownMenuRadioItem key={workspace.id} value={workspace.id} className="h-auto py-2">
                    <span className="min-w-0">
                      <span className="block truncate">{workspace.name}</span>
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {t(`roles.${workspace.role}`)}
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </Fragment>
          );
        })}
        <DropdownMenuSeparator />
        {isManager(current.role) ? (
          <DropdownMenuItem asChild>
            <Link href={`/espaces/${current.id}/membres`} onClick={onNavigate}>
              <Users aria-hidden="true" />
              {t("manageMembers")}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href={`/espaces/${current.id}/modeles`} onClick={onNavigate}>
            <BookText aria-hidden="true" />
            {tShell("promptLibrary")}
          </Link>
        </DropdownMenuItem>
        {isManager(current.role) ? (
          <DropdownMenuItem asChild>
            <Link href={`/espaces/${current.id}/ia`} onClick={onNavigate}>
              <Gauge aria-hidden="true" />
              {tShell("aiDashboard")}
            </Link>
          </DropdownMenuItem>
        ) : null}
        {current.role === "owner" ? (
          <DropdownMenuItem asChild>
            <Link href={`/espaces/${current.id}/parametres`} onClick={onNavigate}>
              <Settings aria-hidden="true" />
              {t("settings")}
            </Link>
          </DropdownMenuItem>
        ) : null}
        {current.ownsOrganization ? (
          <DropdownMenuItem asChild>
            <Link href={`/organisations/${current.organizationId}`} onClick={onNavigate}>
              <Building2 aria-hidden="true" />
              {t("organization")}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href="/espaces/nouveau" onClick={onNavigate}>
            <Plus aria-hidden="true" />
            {t("create")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
