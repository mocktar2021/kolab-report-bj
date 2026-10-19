"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, LogOut, UserRound } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LegalLinks } from "@/components/legal/legal-links";
import { InstallAppButton } from "@/components/pwa/install-app";
import { GUIDE_PATH } from "@/content/guide/pages";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Link } from "@/i18n/navigation";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { NavItems } from "./nav-items";
import { SearchTrigger } from "./search-trigger";
import { AccountLink, SignOutForm } from "./sidebar-controls";
import { UserAvatar } from "./user-avatar";
import { WorkspaceSwitcher } from "./workspace-switcher";

const rowClass =
  "flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

export type MenuSheetProps = {
  user: { name: string; email: string };
  workspaces: MyWorkspace[];
  currentWorkspaceId: string | null;
  /** Owners and admins of the current workspace. */
  manager: boolean;
  billingOrganizationId: string | null;
};

/**
 * The menu below lg: the sidebar's content in a sheet. MobileMenu loads it on
 * the first tap (KRB-212). It closes on navigation.
 */
export function MenuSheet({
  open,
  onOpenChange,
  user,
  workspaces,
  currentWorkspaceId,
  manager,
  billingOrganizationId,
}: MenuSheetProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("AppShell");
  const tCommon = useTranslations("Common");
  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
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
            onNavigate={close}
          />
          <SearchTrigger />
        </div>
        <nav aria-label={t("navLabel")} className="mt-6 flex-1 overflow-y-auto px-3">
          <Suspense>
            <NavItems
              variant="sheet"
              workspaceId={currentWorkspaceId}
              manager={manager}
              billingOrganizationId={billingOrganizationId}
              onNavigate={close}
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
          <AccountLink className={rowClass} onNavigate={close}>
            <UserRound className="size-4" aria-hidden="true" />
            {t("account")}
          </AccountLink>
          <Link href={GUIDE_PATH} prefetch={false} onClick={close} className={rowClass}>
            <BookOpen className="size-4" aria-hidden="true" />
            {t("guide")}
          </Link>
          <InstallAppButton className={rowClass} />
          <ThemeToggle variant="row" side="top" align="start" />
          <SignOutForm>
            <button type="submit" className={rowClass}>
              <LogOut className="size-4" aria-hidden="true" />
              {tCommon("signOut")}
            </button>
          </SignOutForm>
          <LegalLinks className="px-2.5 pt-2" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
