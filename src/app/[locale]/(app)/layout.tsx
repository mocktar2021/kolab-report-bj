import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/app-shell/app-shell";
import { SIDEBAR_INIT_SCRIPT } from "@/components/app-shell/sidebar-script";
import { BillingBanner } from "@/components/billing/billing-banner";
import { MonitoringUser } from "@/components/monitoring/monitoring-user";
import { ClientMessages } from "@/i18n/client-messages-provider";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getBillingBanner, getRenewerNames, readWorkspaceBillingState } from "@/lib/billing/banner";
import { getMyBillingOrganizations } from "@/lib/billing/state";
import { countUnreadNotifications } from "@/lib/notifications";
import { getCurrentProfile } from "@/lib/supabase/user";
import { CURRENT_WORKSPACE_COOKIE, getCurrentWorkspace, getMyWorkspaces } from "@/lib/workspaces/server";

// Every page under (app) depends on the session and the workspace cookie.
export const dynamic = "force-dynamic";

// App shell for signed-in pages. The proxy already sends visitors
// without a session to /fr/connexion; the redirect here is a second check.
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const profile = await getCurrentProfile();
  if (!profile) {
    return redirect({ href: "/connexion", locale });
  }

  // The billing state of the workspace in the switcher cookie is read with
  // the rest, so the banner costs no extra round trip. Only when the cookie
  // is missing or stale is the current workspace's state read after. The
  // organizations whose billing the user reads decide the "Abonnement" link.
  const cookieWorkspaceId = (await cookies()).get(CURRENT_WORKSPACE_COOKIE)?.value;
  const [workspaces, current, unreadNotifications, billingOrganizationIds] = await Promise.all([
    getMyWorkspaces(),
    getCurrentWorkspace(),
    countUnreadNotifications(),
    getMyBillingOrganizations(),
    cookieWorkspaceId ? readWorkspaceBillingState(cookieWorkspaceId) : null,
  ]);
  const banner = current ? await getBillingBanner(current.id) : null;
  // Names of who to ask, only for members who cannot renew themselves.
  const renewers = current && banner && !banner.canManage ? await getRenewerNames(current.id) : [];

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      <MonitoringUser id={profile.id} />
      <ClientMessages locale={locale} scope="appShell">
        <AppShell
          user={{ name: profile.name, email: profile.email }}
          workspaces={workspaces}
          currentWorkspaceId={current?.id ?? null}
          unreadNotifications={unreadNotifications}
          banner={banner ? <BillingBanner banner={banner} renewers={renewers} /> : null}
          billingOrganizationIds={billingOrganizationIds}
        >
          {children}
        </AppShell>
      </ClientMessages>
    </>
  );
}
