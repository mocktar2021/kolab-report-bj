import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { signOut } from "@/lib/auth/actions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { AcceptForm } from "./accept-form";

// Depends on the token and on the session.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Invitation");
  // The URL holds a secret token: keep it out of search engines.
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ locale: "fr"; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Invitation");
  const tWorkspaces = await getTranslations("Workspaces");
  const tCommon = await getTranslations("Common");
  const format = await getFormatter();

  const supabase = await createClient();
  const [{ data }, user] = await Promise.all([
    supabase.rpc("invitation_preview", { token }).maybeSingle(),
    getCurrentUser(),
  ]);

  if (!data || data.status === "revoked") {
    return <Problem title={t("invalidTitle")} message={t("invalid")} signedIn={Boolean(user)} />;
  }
  if (data.status === "expired") {
    // Nobody to ask when the sender's account is gone: the workspace's managers resend it.
    const message = data.invited_by_name ? t("expired") : t("expiredNoInviter");
    return <Problem title={t("expiredTitle")} message={message} signedIn={Boolean(user)} />;
  }
  if (data.status === "accepted") {
    // Signing in already accepts open invitations, so the person who used this
    // link often lands here right after. The function only answers without an
    // error for them; it changes nothing on an accepted invitation.
    const { error } = user ? await supabase.rpc("accept_workspace_invitation", { token }) : { error: true };
    if (!error) {
      return (
        <AuthShell title={t("joinedTitle", { workspace: data.workspace_name })} description={t("joined")}>
          <AcceptForm token={token} label="open" />
        </AuthShell>
      );
    }
    return <Problem title={t("usedTitle")} message={t("used")} signedIn={Boolean(user)} />;
  }

  const role = tWorkspaces(`roles.${data.role}`).toLowerCase();
  const userEmail = user?.email?.toLowerCase() ?? null;

  return (
    <AuthShell
      title={t("title", { workspace: data.workspace_name })}
      description={
        data.invited_by_name
          ? t("description", { inviter: data.invited_by_name, role })
          : t("descriptionNoInviter", { role })
      }
    >
      <div className="space-y-5">
        <div className="space-y-1 rounded-xl bg-muted/50 p-4 text-sm">
          <p>{t("organization", { organization: data.organization_name })}</p>
          <p>{t("forEmail", { email: data.email })}</p>
          <p className="text-muted-foreground">
            {t("expires", {
              date: format.dateTime(new Date(data.expires_at), {
                day: "numeric",
                month: "long",
                year: "numeric",
              }),
            })}
          </p>
        </div>

        {!user ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("signUpHint")}</p>
            <Button asChild shape="pill" className="h-10 w-full">
              <Link href={{ pathname: "/inscription", query: { email: data.email } }}>{t("signUp")}</Link>
            </Button>
            <Button asChild variant="outline" shape="pill" className="h-10 w-full">
              <Link href={{ pathname: "/connexion", query: { next: `/fr/invitations/${token}` } }}>
                {t("signIn")}
              </Link>
            </Button>
          </div>
        ) : userEmail !== data.email ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">
              {t("otherAccount", { current: user.email ?? "", email: data.email })}
            </p>
            <form action={signOut}>
              <Button type="submit" variant="outline" shape="pill" className="h-10 w-full">
                {tCommon("signOut")}
              </Button>
            </form>
          </div>
        ) : !user.email_confirmed_at ? (
          <p className="text-sm text-muted-foreground">{t("unconfirmed")}</p>
        ) : (
          <AcceptForm token={token} label="accept" />
        )}
      </div>
    </AuthShell>
  );
}

function Problem({ title, message, signedIn }: { title: string; message: string; signedIn: boolean }) {
  return (
    <AuthShell title={title} description={message}>
      <ProblemLink signedIn={signedIn} />
    </AuthShell>
  );
}

async function ProblemLink({ signedIn }: { signedIn: boolean }) {
  const t = await getTranslations("Invitation");
  return (
    <Button asChild shape="pill" className="h-10 w-full">
      <Link href={signedIn ? "/tableau-de-bord" : "/connexion"}>
        {signedIn ? t("toDashboard") : t("toSignIn")}
      </Link>
    </Button>
  );
}
