"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, Download, LogOut, PanelLeftClose, PanelLeftOpen, UserRound } from "lucide-react";
import { IosInstallSteps, useInstallMode } from "@/components/pwa/install-app";
import { THEME_CHOICES } from "@/components/theme/theme-config";
import { THEME_ICONS, useThemeChoice } from "@/components/theme/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLazyMenuFocus, type LazyMenuProps } from "@/components/ui/lazy-menu";
import { GUIDE_PATH } from "@/content/guide/pages";
import { LEGAL_PAGES, MAIN_LEGAL_PAGE_KEYS } from "@/content/legal/pages";
import { Link, usePathname } from "@/i18n/navigation";
import { signOut } from "@/lib/auth/actions";
import { promptInstall } from "@/lib/pwa/install";
import { clearOfflineCaches } from "@/lib/pwa/clear-offline-caches";
import { AccountButton, type AccountMenuProps } from "./account-menu";
import { ACCOUNT_PATH } from "./paths";
import { SIDEBAR_ID } from "./sidebar-script";
import { useSidebarCollapsed } from "./sidebar-state";

/** The account menu itself, loaded by AccountMenu when its button is used. */
export function AccountDropdown({
  user,
  variant,
  sidebarToggle = false,
  ...lazy
}: AccountMenuProps & LazyMenuProps) {
  const t = useTranslations("AppShell");
  const tCommon = useTranslations("Common");
  const tTheme = useTranslations("Theme");
  const tLegal = useTranslations("Legal.nav");
  const pathname = usePathname();
  const { button, onContentFocus } = useLazyMenuFocus(lazy);
  const { choice, setTheme } = useThemeChoice();
  const installMode = useInstallMode();
  const { collapsed, toggle } = useSidebarCollapsed();
  const [stepsOpen, setStepsOpen] = useState(false);
  const [signingOut, startSignOut] = useTransition();
  // The iPhone install steps open as the menu closes: the dialog keeps the focus.
  const dialogNext = useRef(false);
  const ThemeIcon = THEME_ICONS[choice ?? "system"];

  function install() {
    if (installMode === "prompt") {
      void promptInstall();
      return;
    }
    dialogNext.current = true;
    setStepsOpen(true);
  }

  return (
    <>
      <DropdownMenu defaultOpen={lazy.openedWith !== null}>
        <DropdownMenuTrigger asChild>
          <AccountButton ref={button} user={user} variant={variant} aria-busy={signingOut} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64"
          onFocus={onContentFocus}
          onCloseAutoFocus={(event) => {
            if (!dialogNext.current) return;
            dialogNext.current = false;
            event.preventDefault();
          }}
        >
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-medium">{user.name}</p>
            {user.name !== user.email ? (
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            ) : null}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={ACCOUNT_PATH} aria-current={pathname === ACCOUNT_PATH ? "page" : undefined}>
              <UserRound aria-hidden="true" />
              {t("account")}
            </Link>
          </DropdownMenuItem>
          {/* The user guide (KRB-199), a public page: it opens without the app shell. */}
          <DropdownMenuItem asChild>
            <Link href={GUIDE_PATH} prefetch={false}>
              <BookOpen aria-hidden="true" />
              {t("guide")}
            </Link>
          </DropdownMenuItem>
          {/* Hidden once installed, and in browsers that cannot install the app (KRB-205). */}
          {installMode !== "none" ? (
            <DropdownMenuItem onSelect={install} aria-haspopup={installMode === "ios" ? "dialog" : undefined}>
              <Download aria-hidden="true" />
              {t("install.button")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ThemeIcon aria-hidden="true" />
              {tTheme("label")}
              <span className="ml-auto text-xs text-muted-foreground">{choice ? tTheme(choice) : null}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={choice} onValueChange={setTheme}>
                {THEME_CHOICES.map((option) => {
                  const Icon = THEME_ICONS[option];
                  return (
                    <DropdownMenuRadioItem key={option} value={option}>
                      <Icon aria-hidden="true" />
                      {tTheme(option)}
                    </DropdownMenuRadioItem>
                  );
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {sidebarToggle ? (
            <DropdownMenuItem onSelect={toggle} aria-controls={SIDEBAR_ID}>
              {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
              {collapsed ? t("expand") : t("collapse")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {/* Clears what the service worker kept for offline reading first. */}
          <DropdownMenuItem
            onSelect={() => {
              clearOfflineCaches();
              startSignOut(() => signOut());
            }}
          >
            <LogOut aria-hidden="true" />
            {tCommon("signOut")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup aria-label={tLegal("label")} className="grid grid-cols-2">
            {MAIN_LEGAL_PAGE_KEYS.map((key) => (
              // No prefetch: these links are on every page and rarely followed.
              <DropdownMenuItem key={key} asChild className="h-8 text-xs text-muted-foreground">
                <Link href={LEGAL_PAGES[key]} prefetch={false}>
                  {tLegal(key)}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {installMode === "ios" ? (
        <IosInstallSteps
          open={stepsOpen}
          onOpenChange={setStepsOpen}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            button.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}
