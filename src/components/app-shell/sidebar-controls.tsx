"use client";

import { useTranslations } from "next-intl";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { signOut } from "@/lib/auth/actions";
import { clearOfflineCaches } from "@/lib/pwa/clear-offline-caches";
import { ACCOUNT_PATH } from "./paths";
import { SIDEBAR_ID } from "./sidebar-script";
import { useSidebarCollapsed } from "./sidebar-state";

// The parts of the server-rendered sidebar that need the browser (KRB-212).
// Their icons and labels come from the server as children.

/** "Mon compte", marked as the current page on /compte. */
export function AccountLink({
  className,
  onNavigate,
  children,
  ...props
}: {
  className: string;
  onNavigate?: () => void;
  children: React.ReactNode;
  "aria-label"?: string;
}) {
  const pathname = usePathname();
  return (
    <Link
      href={ACCOUNT_PATH}
      onClick={onNavigate}
      className={className}
      aria-current={pathname === ACCOUNT_PATH ? "page" : undefined}
      {...props}
    >
      {children}
    </Link>
  );
}

/** Signs out, after clearing what the service worker kept for offline reading. */
export function SignOutForm({ children }: { children: React.ReactNode }) {
  return (
    <form action={signOut} onSubmit={clearOfflineCaches}>
      {children}
    </form>
  );
}

/** Collapses or expands the desktop sidebar, a choice kept in localStorage. */
export function SidebarToggle({ className }: { className: string }) {
  const t = useTranslations("AppShell");
  const { collapsed, toggle } = useSidebarCollapsed();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-controls={SIDEBAR_ID}
      aria-expanded={!collapsed}
      aria-label={collapsed ? t("expand") : t("collapse")}
      className={className}
    >
      <PanelLeftClose className="size-4 shrink-0 sidebar-collapsed:hidden" aria-hidden="true" />
      <PanelLeftOpen className="hidden size-4 shrink-0 sidebar-collapsed:block" aria-hidden="true" />
      <span className="sidebar-collapsed:sr-only">{collapsed ? t("expand") : t("collapse")}</span>
    </button>
  );
}
