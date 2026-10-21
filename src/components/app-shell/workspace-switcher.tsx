"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { ChevronsUpDown, Plus } from "lucide-react";
import { useLazyMenu } from "@/components/ui/lazy-menu";
import { Link } from "@/i18n/navigation";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { cn } from "@/lib/utils";
import { WorkspaceMark } from "./workspace-mark";

export type WorkspaceSwitcherProps = {
  workspaces: MyWorkspace[];
  currentWorkspaceId: string | null;
  /** Hide the text while the desktop sidebar is collapsed. */
  collapsible?: boolean;
  onNavigate?: () => void;
  /** Opens the workspace search (KRB-206). By default, the one of the app shell's palette. */
  onSearch?: () => void;
};

/**
 * The switcher's button, before and after its menu loads. Its name comes from
 * its text, "Espace de travail actuel : <name>", so that it holds the visible
 * label (WCAG 2.5.3, KRB-222). The organization or role line is its
 * description: hidden from the name, still read after it.
 */
export function SwitcherButton({
  current,
  collapsible,
  className,
  ...props
}: React.ComponentProps<"button"> & { current: MyWorkspace; collapsible: boolean }) {
  const t = useTranslations("Workspaces");
  const descriptionId = useId();

  return (
    <button
      type="button"
      aria-describedby={descriptionId}
      className={cn(
        "flex h-12 w-full items-center gap-3 rounded-lg px-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent",
        collapsible && "sidebar-collapsed:justify-center sidebar-collapsed:px-0",
        className,
      )}
      {...props}
    >
      <WorkspaceMark name={current.name} />
      <span className={cn("min-w-0 flex-1", collapsible && "sidebar-collapsed:sr-only")}>
        <span className="block truncate text-sm font-medium text-foreground">
          <span className="sr-only">{t("switcherCurrent")} </span>
          {current.name}
        </span>
        <span id={descriptionId} className="block truncate text-xs text-muted-foreground" aria-hidden="true">
          {current.organizationName ?? t(`roles.${current.role}`)}
        </span>
      </span>
      <ChevronsUpDown
        className={cn("size-4 shrink-0 text-muted-foreground", collapsible && "sidebar-collapsed:hidden")}
        aria-hidden="true"
      />
    </button>
  );
}

// The menu, Radix and the workspace actions load when the button is pointed
// at or focused, not with the page (KRB-212).
const loadWorkspaceMenu = () => import("./workspace-menu").then((mod) => mod.WorkspaceMenu);

/**
 * The current workspace and the menu to switch it (workspace-menu.tsx), or the
 * link to create one when there is none yet.
 */
export function WorkspaceSwitcher({
  workspaces,
  currentWorkspaceId,
  collapsible = false,
  onNavigate,
  onSearch,
}: WorkspaceSwitcherProps) {
  const t = useTranslations("Workspaces");
  const { Menu, menuProps, placeholderProps } = useLazyMenu(loadWorkspaceMenu);
  const current = workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null;

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

  return Menu ? (
    <Menu
      workspaces={workspaces}
      current={current}
      collapsible={collapsible}
      onNavigate={onNavigate}
      onSearch={onSearch}
      {...menuProps}
    />
  ) : (
    <SwitcherButton current={current} collapsible={collapsible} {...placeholderProps} />
  );
}
