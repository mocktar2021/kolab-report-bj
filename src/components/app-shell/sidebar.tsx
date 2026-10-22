import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { Link } from "@/i18n/navigation";
import { isManager } from "@/lib/workspaces/roles";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { AccountMenu } from "./account-menu";
import { NavItems } from "./nav-items";
import { NotificationBell } from "./notification-bell";
import { SearchTrigger } from "./search-trigger";
import { SIDEBAR_ID } from "./sidebar-script";
import { WorkspaceSwitcher } from "./workspace-switcher";

type SidebarProps = {
  user: { name: string; email: string };
  workspaces: MyWorkspace[];
  currentWorkspaceId: string | null;
  unreadNotifications: number;
  /** The organization whose billing page the "Abonnement" link opens, if any. */
  billingOrganizationId: string | null;
};

/**
 * Desktop navigation (lg and up). Width follows <html data-sidebar>. It is the
 * page header on wide screens, so screen readers list it as the banner
 * landmark, like the top bar below lg.
 *
 * The account menu sits in the bar top right of the page (KRB-227), but its
 * markup stays here, at the end of the banner: the tab order goes from the
 * sidebar to the account menu, then to the page. The bar is fixed to the
 * window, which works because the sidebar has no backdrop filter: one would
 * hold its fixed children inside it.
 *
 * A Server Component (KRB-212): the logo and the links cost no hydration.
 * Only the parts that need state or the pathname are Client Components.
 */
export function Sidebar({
  user,
  workspaces,
  currentWorkspaceId,
  unreadNotifications,
  billingOrganizationId,
}: SidebarProps) {
  const t = useTranslations("AppShell");
  const current = workspaces.find((workspace) => workspace.id === currentWorkspaceId);

  return (
    <header
      id={SIDEBAR_ID}
      className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r bg-card/60 transition-[width] duration-300 ease-out-expo lg:flex sidebar-collapsed:w-[4.5rem]"
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
        <SearchTrigger collapsible />
      </div>

      {/*
        On a short screen the links scroll. pt-1 leaves room for the focus
        rings. Collapsed, the labels show as tooltips beside the rail and must
        not be clipped.
      */}
      <nav
        aria-label={t("navLabel")}
        className="mt-5 min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1 sidebar-collapsed:overflow-visible"
      >
        {/* useSearchParams in the navigation needs a Suspense boundary. */}
        <Suspense>
          <NavItems
            variant="sidebar"
            workspaceId={currentWorkspaceId}
            manager={current ? isManager(current.role) : false}
            billingOrganizationId={billingOrganizationId}
          />
        </Suspense>
      </nav>

      {/* As high as the logo row, so their bottoms line up. */}
      <div className="fixed left-64 right-0 top-0 flex h-16 items-center justify-end border-b bg-background/80 px-4 backdrop-blur-md transition-[left] duration-300 ease-out-expo sidebar-collapsed:left-[4.5rem]">
        <AccountMenu user={user} variant="pill" sidebarToggle />
      </div>
    </header>
  );
}
