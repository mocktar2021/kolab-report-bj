"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { BookOpen, LogOut, Menu, Search, UserRound } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LegalLinks } from "@/components/legal/legal-links";
import { InstallAppButton } from "@/components/pwa/install-app";
import { GUIDE_PATH } from "@/content/guide/pages";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Link } from "@/i18n/navigation";
import { signOut } from "@/lib/auth/actions";
import { clearOfflineCaches } from "@/lib/pwa/clear-offline-caches";
import { isManager } from "@/lib/workspaces/roles";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { billingOrganizationOf } from "@/lib/billing/navigation";
import type { PaletteScope } from "./command-palette";
import { NavItems } from "./nav-items";
import { NotificationBell } from "./notification-bell";
import { SearchTrigger } from "./search-trigger";
import { ACCOUNT_PATH, Sidebar } from "./sidebar";
import { UserAvatar } from "./user-avatar";
import { WorkspaceSwitcher } from "./workspace-switcher";

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

// The palette and cmdk load the first time it opens, not with every page
// (KRB-154).
const CommandPalette = dynamic(() => import("./command-palette").then((mod) => mod.CommandPalette), {
  ssr: false,
});

const iconButtonClass =
  "flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Frame for signed-in pages: sidebar from lg up, a top bar with a sheet menu
 * below lg, and the command palette on Cmd+K or Ctrl+K.
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
  const tCommon = useTranslations("Common");
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Stays mounted once opened, so it can play its closing animation.
  const [paletteMounted, setPaletteMounted] = useState(false);
  const [paletteScope, setPaletteScope] = useState<PaletteScope>("all");
  const paletteOpenRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const current = workspaces.find((workspace) => workspace.id === currentWorkspaceId);

  useEffect(() => {
    paletteOpenRef.current = paletteOpen;
  }, [paletteOpen]);

  const showPalette = useCallback((scope: PaletteScope) => {
    setMenuOpen(false);
    setPaletteScope(scope);
    setPaletteMounted(true);
    setPaletteOpen(true);
  }, []);
  const openPalette = useCallback(() => showPalette("all"), [showPalette]);
  // "Rechercher un espace" in the workspace switcher (KRB-206).
  const searchWorkspaces = useCallback(() => showPalette("workspaces"), [showPalette]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (paletteOpenRef.current) {
          setPaletteOpen(false);
        } else {
          showPalette("all");
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showPalette]);

  return (
    <div className="min-h-dvh">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:text-background"
      >
        {t("skipToContent")}
      </a>

      {/* useSearchParams in the navigation needs a Suspense boundary. */}
      <Suspense>
        <Sidebar
          user={user}
          workspaces={workspaces}
          currentWorkspaceId={currentWorkspaceId}
          unreadNotifications={unreadNotifications}
          billingOrganizationId={billingOrganizationId}
          onOpenPalette={openPalette}
          onSearchWorkspaces={searchWorkspaces}
        />
      </Suspense>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={t("openMenu")}
          aria-expanded={menuOpen}
          className={iconButtonClass}
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <Link href="/tableau-de-bord" aria-label={t("home")} className="rounded-lg">
          <Logo />
        </Link>
        <NotificationBell unread={unreadNotifications} className="ml-auto" />
        <button
          type="button"
          onClick={openPalette}
          aria-label={t("searchLabel")}
          aria-keyshortcuts="Meta+K Control+K"
          className={iconButtonClass}
        >
          <Search className="size-5" aria-hidden="true" />
        </button>
      </header>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent closeLabel={t("closeMenu")}>
          <SheetTitle className="sr-only">{t("menuTitle")}</SheetTitle>
          <SheetDescription className="sr-only">{t("menuDescription")}</SheetDescription>
          <div className="flex h-14 shrink-0 items-center px-5">
            <Logo />
          </div>
          <div className="space-y-3 px-3">
            <WorkspaceSwitcher
              workspaces={workspaces}
              currentWorkspaceId={currentWorkspaceId}
              onNavigate={() => setMenuOpen(false)}
              onSearch={searchWorkspaces}
            />
            <SearchTrigger onOpen={openPalette} />
          </div>
          <nav aria-label={t("navLabel")} className="mt-6 flex-1 overflow-y-auto px-3">
            <Suspense>
              <NavItems
                variant="sheet"
                workspaceId={currentWorkspaceId}
                manager={current ? isManager(current.role) : false}
                billingOrganizationId={billingOrganizationId}
                onNavigate={() => setMenuOpen(false)}
              />
            </Suspense>
          </nav>
          <div className="space-y-1 border-t p-3">
            <div className="flex items-center gap-3 px-1.5 py-2">
              <UserAvatar name={user.name} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.name}</p>
                {user.name !== user.email ? (
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                ) : null}
              </div>
            </div>
            <Link
              href={ACCOUNT_PATH}
              onClick={() => setMenuOpen(false)}
              className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <UserRound className="size-4" aria-hidden="true" />
              {t("account")}
            </Link>
            <Link
              href={GUIDE_PATH}
              prefetch={false}
              onClick={() => setMenuOpen(false)}
              className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BookOpen className="size-4" aria-hidden="true" />
              {t("guide")}
            </Link>
            <InstallAppButton className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" />
            <ThemeToggle variant="row" side="top" align="start" />
            <form action={signOut} onSubmit={clearOfflineCaches}>
              <button
                type="submit"
                className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <LogOut className="size-4" aria-hidden="true" />
                {tCommon("signOut")}
              </button>
            </form>
            <LegalLinks className="px-2.5 pt-2" />
          </div>
        </SheetContent>
      </Sheet>

      <div className="transition-[padding] duration-300 ease-out-expo lg:pl-64 lg:sidebar-collapsed:pl-[4.5rem]">
        {banner}
        <main id="contenu" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>

      {paletteMounted ? (
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          scope={paletteScope}
          workspaces={workspaces}
          currentWorkspaceId={currentWorkspaceId}
        />
      ) : null}
    </div>
  );
}
