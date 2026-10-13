"use client";

import { useTranslations } from "next-intl";
import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Link } from "@/i18n/navigation";
import { signOut } from "@/lib/auth/actions";
import { clearOfflineCaches } from "@/lib/pwa/clear-offline-caches";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { NavItems } from "./nav-items";
import { SearchTrigger } from "./search-trigger";
import { useSidebarCollapsed } from "./sidebar-state";
import { UserAvatar } from "./user-avatar";
import { WorkspaceSwitcher } from "./workspace-switcher";

export const SIDEBAR_ID = "app-sidebar";

const footerButtonClass =
  "flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sidebar-collapsed:justify-center sidebar-collapsed:px-0";

type SidebarProps = {
  user: { name: string; email: string };
  workspaces: MyWorkspace[];
  currentWorkspaceId: string | null;
  onOpenPalette: () => void;
};

/** Desktop navigation (lg and up). Width follows <html data-sidebar>. */
export function Sidebar({ user, workspaces, currentWorkspaceId, onOpenPalette }: SidebarProps) {
  const t = useTranslations("AppShell");
  const tCommon = useTranslations("Common");
  const { collapsed, toggle } = useSidebarCollapsed();

  return (
    <aside
      id={SIDEBAR_ID}
      className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r bg-card/60 backdrop-blur-md transition-[width] duration-300 ease-out-expo lg:flex sidebar-collapsed:w-[4.5rem]"
    >
      <div className="flex h-16 shrink-0 items-center px-5 sidebar-collapsed:justify-center sidebar-collapsed:px-0">
        <Link href="/tableau-de-bord" aria-label={t("home")} className="rounded-lg">
          <Logo wordmarkClassName="sidebar-collapsed:sr-only" />
        </Link>
      </div>

      <div className="space-y-3 px-3">
        <WorkspaceSwitcher workspaces={workspaces} currentWorkspaceId={currentWorkspaceId} collapsible />
        <SearchTrigger onOpen={onOpenPalette} collapsible />
      </div>

      <nav aria-label={t("navLabel")} className="mt-6 flex-1 px-3">
        <NavItems variant="sidebar" workspaceId={currentWorkspaceId} />
      </nav>

      <div className="space-y-1 border-t p-3">
        <div
          className="flex items-center gap-3 rounded-lg px-1.5 py-2 sidebar-collapsed:justify-center sidebar-collapsed:px-0"
          title={user.email}
        >
          <UserAvatar name={user.name} />
          <div className="min-w-0 sidebar-collapsed:sr-only">
            <p className="truncate text-sm font-medium">{user.name}</p>
            {user.name !== user.email ? (
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            ) : null}
          </div>
        </div>
        <ThemeToggle variant="row" collapsible side="right" align="end" />
        <form action={signOut} onSubmit={clearOfflineCaches}>
          <button type="submit" className={footerButtonClass} aria-label={tCommon("signOut")}>
            <LogOut className="size-4 shrink-0" aria-hidden="true" />
            <span className="sidebar-collapsed:sr-only">{tCommon("signOut")}</span>
          </button>
        </form>
        <button
          type="button"
          onClick={toggle}
          aria-controls={SIDEBAR_ID}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("expand") : t("collapse")}
          className={footerButtonClass}
        >
          <PanelLeftClose className="size-4 shrink-0 sidebar-collapsed:hidden" aria-hidden="true" />
          <PanelLeftOpen className="hidden size-4 shrink-0 sidebar-collapsed:block" aria-hidden="true" />
          <span className="sidebar-collapsed:sr-only">{collapsed ? t("expand") : t("collapse")}</span>
        </button>
      </div>
    </aside>
  );
}
