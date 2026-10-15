"use client";

import { useTranslations } from "next-intl";
import { LogOut, PanelLeftClose, PanelLeftOpen, UserRound } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LegalLinks } from "@/components/legal/legal-links";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Link, usePathname } from "@/i18n/navigation";
import { signOut } from "@/lib/auth/actions";
import { clearOfflineCaches } from "@/lib/pwa/clear-offline-caches";
import { isManager } from "@/lib/workspaces/roles";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { NavItems } from "./nav-items";
import { NotificationBell } from "./notification-bell";
import { SearchTrigger } from "./search-trigger";
import { useSidebarCollapsed } from "./sidebar-state";
import { UserAvatar } from "./user-avatar";
import { WorkspaceSwitcher } from "./workspace-switcher";

export const SIDEBAR_ID = "app-sidebar";

/** Name, data export, organization transfer and account deletion (KRB-186). */
export const ACCOUNT_PATH = "/compte";

const footerButtonClass =
  "flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sidebar-collapsed:justify-center sidebar-collapsed:px-0";

type SidebarProps = {
  user: { name: string; email: string };
  workspaces: MyWorkspace[];
  currentWorkspaceId: string | null;
  unreadNotifications: number;
  /** The organization whose billing page the "Abonnement" link opens, if any. */
  billingOrganizationId: string | null;
  onOpenPalette: () => void;
};

/**
 * Desktop navigation (lg and up). Width follows <html data-sidebar>. It is the
 * page header on wide screens, so screen readers list it as the banner
 * landmark, like the top bar below lg.
 */
export function Sidebar({
  user,
  workspaces,
  currentWorkspaceId,
  unreadNotifications,
  billingOrganizationId,
  onOpenPalette,
}: SidebarProps) {
  const t = useTranslations("AppShell");
  const tCommon = useTranslations("Common");
  const { collapsed, toggle } = useSidebarCollapsed();
  const pathname = usePathname();
  const current = workspaces.find((workspace) => workspace.id === currentWorkspaceId);

  return (
    <header
      id={SIDEBAR_ID}
      className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r bg-card/60 backdrop-blur-md transition-[width] duration-300 ease-out-expo lg:flex sidebar-collapsed:w-[4.5rem]"
    >
      {/* Collapsed, the bell goes under the logo: the rail is too narrow for both. */}
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 pl-5 pr-3 sidebar-collapsed:h-auto sidebar-collapsed:flex-col sidebar-collapsed:justify-center sidebar-collapsed:px-0 sidebar-collapsed:py-3">
        <Link href="/tableau-de-bord" aria-label={t("home")} className="rounded-lg">
          <Logo wordmarkClassName="sidebar-collapsed:sr-only" />
        </Link>
        <NotificationBell unread={unreadNotifications} />
      </div>

      <div className="space-y-3 px-3">
        <WorkspaceSwitcher workspaces={workspaces} currentWorkspaceId={currentWorkspaceId} collapsible />
        <SearchTrigger onOpen={onOpenPalette} collapsible />
      </div>

      {/*
        On a short screen the links scroll, so the account block and the legal
        links stay visible. pt-1 and pb-1 leave room for the focus rings.
        Collapsed, the labels show as tooltips beside the rail and must not be
        clipped; the footer is shorter then, without the legal links.
      */}
      <nav
        aria-label={t("navLabel")}
        className="mt-5 min-h-0 flex-1 overflow-y-auto px-3 pb-1 pt-1 sidebar-collapsed:overflow-visible"
      >
        <NavItems
          variant="sidebar"
          workspaceId={currentWorkspaceId}
          manager={current ? isManager(current.role) : false}
          billingOrganizationId={billingOrganizationId}
        />
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
        <Link
          href={ACCOUNT_PATH}
          className={footerButtonClass}
          aria-label={t("account")}
          aria-current={pathname === ACCOUNT_PATH ? "page" : undefined}
        >
          <UserRound className="size-4 shrink-0" aria-hidden="true" />
          <span className="sidebar-collapsed:sr-only">{t("account")}</span>
        </Link>
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
        {/* Too long for the collapsed rail: expand the menu to see them. */}
        <LegalLinks className="px-2.5 pt-2 sidebar-collapsed:hidden" />
      </div>
    </header>
  );
}
