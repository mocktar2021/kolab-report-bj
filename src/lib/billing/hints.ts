import "server-only";
import { getTranslations } from "next-intl/server";
import type { WorkspaceUsage } from "./state";
import { draftsHint, membersHint, reportsHint } from "./usage";

// The usage hints where limits bite (KRB-177): the members page, the
// "Nouveau rapport" dialog and the AI draft panel. Each page reads the
// usage once (getWorkspaceUsage) with the rest of its data and passes the
// sentence to its Client Component, so the client gets a string and no
// extra messages. Null while billing is not enforced or when nothing is
// limited.

/** "Offre Indépendant : 3 membres sur 3. Les lecteurs sont gratuits." */
export async function membersHintText(usage: WorkspaceUsage | null): Promise<string | null> {
  const hint = membersHint(usage);
  if (!hint) return null;
  const t = await getTranslations("Billing.meter");
  return t("membersHint", {
    mission: String(hint.mission),
    plan: hint.plan,
    usage: t("membersUsage", { members: hint.members, invitations: hint.invitations, max: hint.max }),
  });
}

/** "Offre Indépendant : 2 rapports actifs sur 3. Un rapport final ne compte plus." */
export async function reportsHintText(usage: WorkspaceUsage | null): Promise<string | null> {
  const hint = reportsHint(usage);
  if (!hint) return null;
  const t = await getTranslations("Billing.meter");
  if (hint.kind === "mission") return t("reportsHintMission");
  return t("reportsHint", { plan: hint.plan, count: hint.count, max: hint.max });
}

/** "12 brouillons IA restants ce mois-ci, plus 100 brouillons IA de Packs IA." */
export async function draftsHintText(usage: WorkspaceUsage | null): Promise<string | null> {
  const hint = draftsHint(usage);
  if (!hint) return null;
  const t = await getTranslations("Billing.meter");
  const allowance =
    hint.period === "month"
      ? t("draftsLeftMonth", { count: hint.left })
      : hint.period === "trial"
        ? t("draftsLeftTrial", { count: hint.left })
        : t("draftsLeftMission", { count: hint.left });
  return hint.packs > 0
    ? t("draftsHintPacks", { allowance, count: hint.packs })
    : t("draftsHint", { allowance });
}
