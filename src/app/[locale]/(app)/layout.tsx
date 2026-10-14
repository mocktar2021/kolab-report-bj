import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/app-shell/app-shell";
import { SIDEBAR_INIT_SCRIPT } from "@/components/app-shell/sidebar-script";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { countUnreadNotifications } from "@/lib/notifications";
import { getCurrentProfile } from "@/lib/supabase/user";
import { getCurrentWorkspace, getMyWorkspaces } from "@/lib/workspaces/server";

// Every page under (app) depends on the session and the workspace cookie.
export const dynamic = "force-dynamic";

// App shell for signed-in pages. The middleware already sends visitors
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

  const [workspaces, current, unreadNotifications] = await Promise.all([
    getMyWorkspaces(),
    getCurrentWorkspace(),
    countUnreadNotifications(),
  ]);

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      <AppShell
        user={{ name: profile.name, email: profile.email }}
        workspaces={workspaces}
        currentWorkspaceId={current?.id ?? null}
        unreadNotifications={unreadNotifications}
      >
        {children}
      </AppShell>
    </>
  );
}
