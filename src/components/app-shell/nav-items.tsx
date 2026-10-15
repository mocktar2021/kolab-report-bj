"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { BookText, CreditCard, Gauge, LayoutDashboard } from "lucide-react";
import { LazyMotion } from "motion/react";
import * as m from "motion/react-m";
import { STATUS_DOT_STYLES } from "@/components/status-badge";
import { Link, usePathname } from "@/i18n/navigation";
import { SECTION_STATUSES, isSectionStatus } from "@/lib/section-statuses";
import { cn } from "@/lib/utils";
import { isManager } from "@/lib/workspaces/roles";
import type { MyWorkspace } from "@/lib/workspaces/types";

const DASHBOARD_PATH = "/tableau-de-bord";

/**
 * The organization of the current workspace when the user reads its billing
 * (ADR 001, 3.5): they own or administer one of its workspaces. Same rule as
 * private.can_read_org_billing, from the memberships the shell already has.
 */
export function billingOrganizationOf(
  workspaces: readonly MyWorkspace[],
  currentWorkspaceId: string | null,
): string | null {
  const current = workspaces.find((workspace) => workspace.id === currentWorkspaceId);
  if (!current) return null;
  return workspaces.some(
    (workspace) => workspace.organizationId === current.organizationId && isManager(workspace.role),
  )
    ? current.organizationId
    : null;
}

// The sliding highlight needs motion's layout features (about 30 kB
// compressed). They load in their own chunk once the shell has hydrated, so
// signed-in pages no longer evaluate them on load (KRB-154). Until then the
// highlight shows in place, without animation.
//
// Only from the lg breakpoint, where the sidebar shows. Below it the nav sits
// in the menu sheet, which closes on navigation, so the highlight never gets
// to slide and phones skip the download.
const loadLayoutFeatures = () =>
  window.matchMedia("(min-width: 1024px)").matches
    ? import("@/components/motion/layout-features").then((mod) => mod.default)
    : new Promise<never>(() => {});

type NavItemsProps = {
  /** "sidebar" hides labels when the desktop sidebar is collapsed; "sheet" never does. */
  variant: "sidebar" | "sheet";
  /** The workspace picked in the switcher, for the links that belong to one workspace. */
  workspaceId: string | null;
  /** Owners and admins of that workspace, who also get its manager-only pages. */
  manager?: boolean;
  /** The organization whose billing page the user reads (billingOrganizationOf). */
  billingOrganizationId?: string | null;
  onNavigate?: () => void;
};

/** Links of the app navigation, shared by the desktop sidebar and the mobile sheet. */
export function NavItems(props: NavItemsProps) {
  return (
    <LazyMotion features={loadLayoutFeatures}>
      <NavItemList {...props} />
    </LazyMotion>
  );
}

function NavItemList({
  variant,
  workspaceId,
  manager = false,
  billingOrganizationId = null,
  onNavigate,
}: NavItemsProps) {
  const t = useTranslations("AppShell");
  const tFilters = useTranslations("Dashboard.filters");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const statut = searchParams.get("statut");
  const activeStatus = isSectionStatus(statut) ? statut : null;
  const onDashboard = pathname === DASHBOARD_PATH;
  const promptsPath = workspaceId ? `/espaces/${workspaceId}/modeles` : null;
  const aiPath = workspaceId && manager ? `/espaces/${workspaceId}/ia` : null;
  const billingPath = billingOrganizationId ? `/organisations/${billingOrganizationId}/abonnement` : null;
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
        {promptsPath ? (
          <NavItem
            href={promptsPath}
            label={t("promptLibrary")}
            active={pathname === promptsPath || pathname.startsWith(`${promptsPath}/`)}
            variant={variant}
            onNavigate={onNavigate}
            icon={<BookText className="size-4" aria-hidden="true" />}
          />
        ) : null}
        {aiPath ? (
          <NavItem
            href={aiPath}
            label={t("aiDashboard")}
            active={pathname === aiPath || pathname.startsWith(`${aiPath}/`)}
            variant={variant}
            onNavigate={onNavigate}
            icon={<Gauge className="size-4" aria-hidden="true" />}
          />
        ) : null}
        {billingPath ? (
          <NavItem
            href={billingPath}
            label={t("billing")}
            active={pathname === billingPath || pathname.startsWith(`${billingPath}/`)}
            variant={variant}
            onNavigate={onNavigate}
            icon={<CreditCard className="size-4" aria-hidden="true" />}
          />
        ) : null}
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
            <m.span
              layoutId={`${variant}-nav-active`}
              aria-hidden="true"
              className="absolute inset-0 rounded-lg bg-highlight/[0.08] ring-1 ring-inset ring-highlight/25"
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
            />
            <m.span
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
