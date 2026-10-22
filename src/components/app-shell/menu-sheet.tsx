"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { NavItems } from "./nav-items";
import { SearchTrigger } from "./search-trigger";
import { WorkspaceSwitcher } from "./workspace-switcher";

export type MenuSheetProps = {
  workspaces: MyWorkspace[];
  currentWorkspaceId: string | null;
  /** Owners and admins of the current workspace. */
  manager: boolean;
  billingOrganizationId: string | null;
};

/**
 * The menu below lg: the sidebar's content in a sheet. MobileMenu loads it on
 * the first tap (KRB-212). It closes on navigation. The account items are in
 * the account menu, at the right end of the top bar (KRB-227).
 */
export function MenuSheet({
  open,
  onOpenChange,
  workspaces,
  currentWorkspaceId,
  manager,
  billingOrganizationId,
}: MenuSheetProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("AppShell");
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
        <nav aria-label={t("navLabel")} className="mt-6 flex-1 overflow-y-auto px-3 pb-4">
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
      </SheetContent>
    </Sheet>
  );
}
