"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutDashboard } from "lucide-react";
import { motion } from "motion/react";
import { STATUS_DOT_STYLES } from "@/components/status-badge";
import { Link, usePathname } from "@/i18n/navigation";
import { SECTION_STATUSES, sectionStatusSchema } from "@/lib/sections";
import { cn } from "@/lib/utils";

const DASHBOARD_PATH = "/tableau-de-bord";

type NavItemsProps = {
  /** "sidebar" hides labels when the desktop sidebar is collapsed; "sheet" never does. */
  variant: "sidebar" | "sheet";
  onNavigate?: () => void;
};

/** Links of the app navigation, shared by the desktop sidebar and the mobile sheet. */
export function NavItems({ variant, onNavigate }: NavItemsProps) {
  const t = useTranslations("AppShell");
  const tFilters = useTranslations("Dashboard.filters");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const parsedStatus = sectionStatusSchema.safeParse(searchParams.get("statut"));
  const activeStatus = parsedStatus.success ? parsedStatus.data : null;
  const onDashboard = pathname === DASHBOARD_PATH;
  const collapsible = variant === "sidebar";

  return (
    <div className="space-y-6">
      <ul className="space-y-0.5">
        <NavItem
          href={DASHBOARD_PATH}
          label={t("dashboard")}
          active={onDashboard && activeStatus === null}
          variant={variant}
          onNavigate={onNavigate}
          icon={<LayoutDashboard className="size-4" aria-hidden="true" />}
        />
      </ul>
      <div>
        <p
          className={cn(
            "px-2.5 text-xs font-medium text-muted-foreground",
            collapsible && "sidebar-collapsed:sr-only",
          )}
        >
          {t("statusGroup")}
        </p>
        <ul className={cn("mt-2 space-y-0.5", collapsible && "sidebar-collapsed:mt-0")}>
          {SECTION_STATUSES.map((status) => (
            <NavItem
              key={status}
              href={`${DASHBOARD_PATH}?statut=${status}`}
              label={tFilters(status)}
              active={onDashboard && activeStatus === status}
              variant={variant}
              onNavigate={onNavigate}
              icon={
                <span className="flex size-4 items-center justify-center" aria-hidden="true">
                  <span className={cn("size-2 rounded-full", STATUS_DOT_STYLES[status])} />
                </span>
              }
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

type NavItemProps = {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  variant: NavItemsProps["variant"];
  onNavigate?: () => void;
};

function NavItem({ href, label, icon, active, variant, onNavigate }: NavItemProps) {
  const collapsible = variant === "sidebar";

  return (
    <li className="relative">
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          active ? "text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          collapsible && "sidebar-collapsed:justify-center sidebar-collapsed:px-0",
        )}
      >
        {active ? (
          <>
            <motion.span
              layoutId={`${variant}-nav-active`}
              aria-hidden="true"
              className="absolute inset-0 rounded-lg bg-highlight/[0.08] ring-1 ring-inset ring-highlight/25"
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
            />
            <motion.span
              layoutId={`${variant}-nav-bar`}
              aria-hidden="true"
              className="absolute -left-3 bottom-2 top-2 w-[3px] rounded-r-full bg-highlight shadow-glow"
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
            />
          </>
        ) : null}
        <span className={cn("relative", active && "text-highlight")}>{icon}</span>
        <span className={cn("relative truncate", collapsible && "sidebar-collapsed:sr-only")}>{label}</span>
        {collapsible ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-full z-50 ml-3 hidden whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md sidebar-collapsed:group-hover:block sidebar-collapsed:group-focus-visible:block"
          >
            {label}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
