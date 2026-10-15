import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AlertCircle, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PUBLISHER } from "@/content/legal/publisher";
import { Link } from "@/i18n/navigation";
import {
  blockerLinks,
  TRANSFER_ANCHOR,
  TRANSFER_DONE,
  TRANSFER_DONE_PARAM,
  type DeletionBlocker,
} from "@/lib/account/blockers";
import { getAccountOverview } from "@/lib/account/server";
import { getCurrentProfile } from "@/lib/supabase/user";
import { DeleteAccount } from "./delete-account";
import { NameForm } from "./name-form";
import { TransferForm } from "./transfer-form";

// Per-user data behind auth: never prerender or cache.
export const dynamic = "force-dynamic";

/** Served by src/app/api/account/export/route.ts. */
const EXPORT_PATH = "/api/account/export";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Account");
  return { title: t("metaTitle") };
}

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: "fr" }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Account");
  const transferred = (await searchParams)[TRANSFER_DONE_PARAM] === TRANSFER_DONE;

  // The (app) layout already sends signed-out visitors to the sign-in page.
  const profile = await getCurrentProfile();
  if (!profile) notFound();
  const overview = await getAccountOverview(profile.id);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-12 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-500">
      <header>
        <h1 className="text-h2 text-foreground">{t("title")}</h1>
        <p className="mt-1 text-small text-muted-foreground">{t("subtitle")}</p>
      </header>

      {transferred ? (
        <p
          role="status"
          className="mt-6 flex items-start gap-2 rounded-xl border border-highlight/30 bg-highlight/5 px-4 py-3 text-sm"
        >
          <Check className="mt-0.5 size-4 shrink-0 text-highlight" aria-hidden="true" />
          {t("transfer.done")}
        </p>
      ) : null}

      <section
        aria-labelledby="profile-title"
        className="surface-card mt-8 rounded-2xl border p-5 shadow-sm sm:p-6"
      >
        <h2 id="profile-title" className="font-medium">
          {t("profile.title")}
        </h2>
        <NameForm fullName={overview.fullName} />
        <dl className="mt-5 space-y-1 text-sm">
          <dt className="font-medium">{t("profile.email")}</dt>
          <dd className="text-muted-foreground">{profile.email}</dd>
          <dd className="text-xs text-muted-foreground">
            {t("profile.emailHint", { email: PUBLISHER.email })}
          </dd>
        </dl>
      </section>

      <section
        aria-labelledby="data-title"
        className="surface-card mt-6 rounded-2xl border p-5 shadow-sm sm:p-6"
      >
        <h2 id="data-title" className="font-medium">
          {t("data.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("data.description")}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("data.content")}</p>
        <Button asChild variant="outline" shape="pill" className="mt-5">
          {/* A plain link: the route answers with the file, not with a page. */}
          <a href={EXPORT_PATH} download>
            <Download aria-hidden="true" />
            {t("data.download")}
          </a>
        </Button>
      </section>

      {overview.organizations.length > 0 ? (
        <section
          id={TRANSFER_ANCHOR}
          aria-labelledby="transfer-title"
          className="surface-card mt-6 scroll-mt-20 rounded-2xl border p-5 shadow-sm sm:p-6"
        >
          <h2 id="transfer-title" className="font-medium">
            {t("transfer.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("transfer.description")}</p>
          <ul className="mt-5 space-y-5">
            {overview.organizations.map((organization) => (
              <li key={organization.id}>
                <TransferForm organization={organization} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        aria-labelledby="delete-title"
        className="surface-card mt-6 rounded-2xl border border-destructive/30 p-5 shadow-sm sm:p-6"
      >
        <h2 id="delete-title" className="font-medium text-destructive">
          {t("delete.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("delete.description")}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t("delete.removed")}</li>
          <li>{t("delete.kept")}</li>
          <li>{t("delete.trial")}</li>
        </ul>

        {overview.blockers === null ? (
          <p role="alert" className="mt-5 flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t("delete.checkFailed")}
          </p>
        ) : overview.blockers.length > 0 ? (
          <Blockers blockers={overview.blockers} />
        ) : (
          <DeleteAccount />
        )}
      </section>
    </div>
  );
}

async function Blockers({ blockers }: { blockers: DeletionBlocker[] }) {
  const t = await getTranslations("Account.delete");

  const text = (blocker: DeletionBlocker) => {
    switch (blocker.kind) {
      case "organization_owner":
        return blocker.successors > 0
          ? t("blockers.organizationOwner", { organization: blocker.organizationName })
          : t("blockers.organizationOwnerAlone", { organization: blocker.organizationName });
      case "only_owner":
        return t("blockers.onlyOwner", { workspace: blocker.workspaceName, count: blocker.otherMembers });
      case "only_member":
        return t("blockers.onlyMember", { workspace: blocker.workspaceName });
    }
  };

  return (
    <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <h3 className="text-sm font-medium">{t("blockedTitle")}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t("blockedDescription")}</p>
      <ul aria-label={t("blockedTitle")} className="mt-3 space-y-3">
        {blockers.map((blocker) => (
          <li key={blocker.kind === "organization_owner" ? blocker.organizationId : blocker.workspaceId}>
            <p className="text-sm">{text(blocker)}</p>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
              {blockerLinks(blocker).map((link) => (
                <Link
                  key={link.key}
                  href={link.href}
                  className="rounded text-sm font-medium text-foreground underline underline-offset-4 hover:text-highlight"
                >
                  {t(`links.${link.key}`)}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
