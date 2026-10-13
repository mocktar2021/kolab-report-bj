import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";

// Per-user data behind auth: never prerender or cache.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Dashboard");
  return { title: t("title") };
}

export default async function TableauDeBordPage({
  params,
}: {
  params: Promise<{ locale: "fr" }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Dashboard");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS scopes this to the workspaces the user belongs to.
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, name")
    .order("created_at", { ascending: false });

  return (
    <main className="container space-y-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("welcome", { name: user?.email ?? "" })}</p>
      </header>
      {workspaces && workspaces.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((ws) => (
            <li key={ws.id} className="rounded-lg border p-4">
              {ws.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t("emptyState")}</p>
      )}
    </main>
  );
}
