"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { LogOut, Menu, Search } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Link } from "@/i18n/navigation";
import { signOut } from "@/lib/auth/actions";
import { clearOfflineCaches } from "@/lib/pwa/clear-offline-caches";
import { isManager } from "@/lib/workspaces/roles";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { CommandPalette } from "./command-palette";
import { NavItems } from "./nav-items";
import { SearchTrigger } from "./search-trigger";
import { Sidebar } from "./sidebar";
import { UserAvatar } from "./user-avatar";
import { WorkspaceSwitcher } from "./workspace-switcher";

type AppShellProps = {
  user: { name: string; email: string };
  workspaces: MyWorkspace[];
  currentWorkspaceId: string | null;
  children: React.ReactNode;
};

const iconButtonClass =
  "flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Frame for signed-in pages: sidebar from lg up, a top bar with a sheet menu
 * below lg, and the command palette on Cmd+K or Ctrl+K.
 */
export function AppShell({ user, workspaces, currentWorkspaceId, children }: AppShellProps) {
  const t = useTranslations("AppShell");
  const tCommon = useTranslations("Common");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const current = workspaces.find((workspace) => workspace.id === currentWorkspaceId);

  const openPalette = useCallback(() => {
    setMenuOpen(false);
    setPaletteOpen(true);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMenuOpen(false);
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
          onOpenPalette={openPalette}
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
        <button
          type="button"
          onClick={openPalette}
          aria-label={t("searchLabel")}
          aria-keyshortcuts="Meta+K Control+K"
          className={`${iconButtonClass} ml-auto`}
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
            />
            <SearchTrigger onOpen={openPalette} />
          </div>
          <nav aria-label={t("navLabel")} className="mt-6 flex-1 overflow-y-auto px-3">
            <Suspense>
              <NavItems
                variant="sheet"
                workspaceId={currentWorkspaceId}
                manager={current ? isManager(current.role) : false}
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
          </div>
        </SheetContent>
      </Sheet>

      <div className="transition-[padding] duration-300 ease-out-expo lg:pl-64 lg:sidebar-collapsed:pl-[4.5rem]">
        <main id="contenu" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
