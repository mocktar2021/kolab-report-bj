import { useTranslations } from "next-intl";
import { Building2, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/**
 * First visit: the user belongs to no workspace yet. `organizations` are the
 * ones they own, which stay after their workspaces are deleted (KRB-180):
 * each links to its page, to add a workspace or delete it.
 */
export function NoWorkspace({ organizations = [] }: { organizations?: { id: string; name: string }[] }) {
  const t = useTranslations("Dashboard.noWorkspace");

  return (
    <section
      aria-labelledby="no-workspace-title"
      className="surface-card mt-8 rounded-2xl border px-6 py-12 text-center shadow-sm"
    >
      <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-highlight/10 text-highlight ring-1 ring-inset ring-highlight/20">
        <FolderPlus className="size-5" aria-hidden="true" />
      </span>
      <h2 id="no-workspace-title" className="mt-4 text-h3">
        {t("title")}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("description")}</p>
      <Button asChild shape="pill" className="mt-6">
        <Link href="/espaces/nouveau">{t("cta")}</Link>
      </Button>
      <p className="mx-auto mt-4 max-w-md text-xs text-muted-foreground">{t("invited")}</p>
      {organizations.length > 0 ? (
        <div className="mx-auto mt-8 max-w-md border-t pt-6 text-left">
          <h3 className="text-sm font-medium">{t("organizationsTitle")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("organizationsDescription")}</p>
          <ul className="mt-3 space-y-1">
            {organizations.map((organization) => (
              <li key={organization.id}>
                <Link
                  href={`/organisations/${organization.id}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{organization.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
