"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { BookText, CreditCard, Gauge, LayoutDashboard } from "lucide-react";
import { STATUS_DOT_STYLES } from "@/components/status-badge";
import { Link, usePathname } from "@/i18n/navigation";
import { SECTION_STATUSES, isSectionStatus } from "@/lib/section-statuses";
import { cn } from "@/lib/utils";

const DASHBOARD_PATH = "/tableau-de-bord";

// The highlight of the active link is a plain span until the pointer or the
// focus first reaches the sidebar. Then nav-highlight.tsx loads, with motion
// and its layout features, and the highlight slides from one link to the next
// (KRB-212). No motion code runs while the page loads: before, the shell
// rendered motion components on every signed-in page (KRB-154 had already
// put the layout features in their own chunk).
//
// Only from the lg breakpoint, where the sidebar shows. Below it the nav sits
// in the menu sheet, which closes on navigation, so the highlight never gets
// to slide and phones skip the download.
type Highlight = typeof import("./nav-highlight").SlidingHighlight;

const highlightClassName =
  "absolute inset-0 rounded-lg bg-highlight/[0.08] ring-1 ring-inset ring-highlight/25";
const barClassName = "absolute -left-3 bottom-2 top-2 w-[3px] rounded-r-full bg-highlight shadow-glow";

function StillHighlight() {
  return (
    <>
      <span aria-hidden="true" className={highlightClassName} />
      <span aria-hidden="true" className={barClassName} />
    </>
  );
}

type NavItemsProps = {
  /** "sidebar" hides labels when the desktop sidebar is collapsed; "sheet" never does. */
  variant: "sidebar" | "sheet";
  /** The workspace picked in the switcher, for the links that belong to one workspace. */
  workspaceId: string | null;
  /** Owners and admins of that workspace, who also get its manager-only pages. */
  manager?: boolean;
  /** The organization whose billing page the user reads, once billing is enforced (billingOrganizationOf). */
  billingOrganizationId?: string | null;
  onNavigate?: () => void;
};

/** Links of the app navigation, shared by the desktop sidebar and the mobile sheet. */
export function NavItems({
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
  const [Sliding, setSliding] = useState<Highlight | null>(null);
  const [loading, setLoading] = useState(false);

  function loadSliding() {
    if (loading || variant !== "sidebar" || !window.matchMedia("(min-width: 1024px)").matches) return;
    setLoading(true);
    void import("./nav-highlight").then((mod) => setSliding(() => mod.SlidingHighlight));
  }

  const highlight = Sliding ? (
    <Sliding variant={variant} backgroundClassName={highlightClassName} barClassName={barClassName} />
  ) : (
    <StillHighlight />
  );

  return (
    <div className="space-y-6" onPointerEnter={loadSliding} onFocus={loadSliding}>
      <ul className="space-y-0.5">
        <NavItem
          href={DASHBOARD_PATH}
          label={t("dashboard")}
          active={onDashboard && activeStatus === null}
          variant={variant}
          highlight={highlight}
          onNavigate={onNavigate}
          icon={<LayoutDashboard className="size-4" aria-hidden="true" />}
        />
        {promptsPath ? (
          <NavItem
            href={promptsPath}
            label={t("promptLibrary")}
            active={pathname === promptsPath || pathname.startsWith(`${promptsPath}/`)}
            variant={variant}
            highlight={highlight}
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
            highlight={highlight}
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
            highlight={highlight}
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
              highlight={highlight}
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
  /** Drawn behind the active link only. */
  highlight: React.ReactNode;
  onNavigate?: () => void;
};

function NavItem({ href, label, icon, active, variant, highlight, onNavigate }: NavItemProps) {
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
        {active ? highlight : null}
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
