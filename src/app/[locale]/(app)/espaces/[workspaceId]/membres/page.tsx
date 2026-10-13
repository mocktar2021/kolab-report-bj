import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/workspaces/members";
import { canManageMember, grantableRoles, isManager } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";
import { MemberList } from "./member-list";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Members");
  return { title: t("metaTitle") };
}

export default async function MembersPage({
  params,
}: {
  params: Promise<{ locale: "fr"; workspaceId: string }>;
}) {
  const { locale, workspaceId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Members");

  // Unknown ids and workspaces the user is not a member of both give a 404.
  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const access = await requireWorkspaceRole(workspaceId);
  if (!access) notFound();

  if (!isManager(access.role)) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="surface-card rounded-2xl border p-6 text-center shadow-sm">
          <ShieldAlert className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-3 text-h3">{t("forbiddenTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("forbiddenDescription")}</p>
          <Button asChild variant="outline" shape="pill" className="mt-5">
            <Link href="/tableau-de-bord">{t("backToDashboard")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: workspace }, members] = await Promise.all([
    supabase.from("workspaces").select("id, name").eq("id", workspaceId).maybeSingle(),
    getWorkspaceMembers(workspaceId),
  ]);
  if (!workspace || !members) notFound();

  const rows = members.map((member) => ({
    ...member,
    isSelf: member.userId === access.userId,
    // Members may always change their own role down or leave; the last-owner
    // trigger stops the last owner.
    editable: member.userId === access.userId || canManageMember(access.role, member.role),
  }));

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
      <Link
        href="/tableau-de-bord"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("backToDashboard")}
      </Link>
      <header className="mt-4">
        <h1 className="text-h2 text-foreground">{t("title", { workspace: workspace.name })}</h1>
        <p className="mt-1 text-small text-muted-foreground">{t("subtitle")}</p>
      </header>

      <MemberList workspaceId={workspaceId} members={rows} grantable={grantableRoles(access.role)} />

      <p className="mt-4 text-xs text-muted-foreground">{t("roleHelp")}</p>
    </div>
  );
}
