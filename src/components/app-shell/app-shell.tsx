import { useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { Link } from "@/i18n/navigation";
import { billingOrganizationOf } from "@/lib/billing/navigation";
import { isManager } from "@/lib/workspaces/roles";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { AccountMenu } from "./account-menu";
import { MobileMenu } from "./mobile-menu";
import { NotificationBell } from "./notification-bell";
import { PaletteProvider } from "./palette";
import { SearchIconButton } from "./search-trigger";
import { Sidebar } from "./sidebar";

type AppShellProps = {
  user: { name: string; email: string };
  workspaces: MyWorkspace[];
  currentWorkspaceId: string | null;
  /** Unread notifications, for the bell. */
  unreadNotifications: number;
  /** The plan of the current workspace, above the page (KRB-178). Outside main, so the skip link lands on the page. */
  banner?: React.ReactNode;
  /** Organizations whose billing page the user reads, empty before the launch. */
  billingOrganizationIds: string[];
  children: React.ReactNode;
};

const iconButtonClass =
  "flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Frame for signed-in pages: sidebar from lg up, a top bar with a sheet menu
 * below lg, the account menu top right at every width (KRB-227), and the
 * command palette on Cmd+K or Ctrl+K.
 *
 * A Server Component (KRB-212), like the sidebar. The palette, the menu
 * button and the controls with state are client islands.
 */
export function AppShell({
  user,
  workspaces,
  currentWorkspaceId,
  unreadNotifications,
  banner,
  billingOrganizationIds,
  children,
}: AppShellProps) {
  const billingOrganizationId = billingOrganizationOf(workspaces, currentWorkspaceId, billingOrganizationIds);
  const t = useTranslations("AppShell");
  const current = workspaces.find((workspace) => workspace.id === currentWorkspaceId);

  return (
    <div className="min-h-dvh">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:text-background"
      >
        {t("skipToContent")}
      </a>

      <PaletteProvider workspaces={workspaces} currentWorkspaceId={currentWorkspaceId}>
        <Sidebar
          user={user}
          workspaces={workspaces}
          currentWorkspaceId={currentWorkspaceId}
          unreadNotifications={unreadNotifications}
          billingOrganizationId={billingOrganizationId}
        />

        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-md lg:hidden">
          <MobileMenu
            className={iconButtonClass}
            workspaces={workspaces}
            currentWorkspaceId={currentWorkspaceId}
            manager={current ? isManager(current.role) : false}
            billingOrganizationId={billingOrganizationId}
          />
          <Link href="/tableau-de-bord" aria-label={t("home")} className="rounded-lg">
            <Logo />
          </Link>
          <NotificationBell unread={unreadNotifications} className="ml-auto" />
          <SearchIconButton className={iconButtonClass} />
          <AccountMenu user={user} variant="avatar" />
        </header>
      </PaletteProvider>

      {/* lg:pt-16 makes room for the account bar, fixed top right. */}
      <div className="transition-[padding] duration-300 ease-out-expo lg:pl-64 lg:pt-16 lg:sidebar-collapsed:pl-[4.5rem]">
        {banner}
        <main id="contenu" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
