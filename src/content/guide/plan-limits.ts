import { OFFERS, PLANS, TRIAL, type PlanLimits } from "@/lib/billing/catalog";
import type { LegalBlock } from "@/content/legal/types";

// The limits of each plan for the FAQ of the guide (KRB-199), read from the
// catalogue like the pricing page (/fr/tarifs). The guide never writes a
// limit itself, so it changes with src/lib/billing/catalog.ts.

const NUMBER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** Plans of the table, in the order of the pricing page: the main grid, then the Pass Mission. */
export const GUIDE_PLAN_CODES = ["trial", "independant", "cabinet", "institution", "mission"] as const;

export type GuidePlanCode = (typeof GUIDE_PLAN_CODES)[number];

function count(value: number, one: string, other: string): string {
  return `${NUMBER.format(value)} ${value === 1 ? one : other}`;
}

/** "5", or "Illimités" when the plan has no limit. */
export function membersCell(limits: PlanLimits): string {
  return limits.maxMembers === null ? "Illimités" : NUMBER.format(limits.maxMembers);
}

/**
 * Subscriptions count active reports (draft and in review), the trial and the
 * Pass Mission every report (ADR 001, 3.4), as on the pricing page.
 */
export function reportsCell(limits: PlanLimits, { activeReports }: { activeReports: boolean }): string {
  if (limits.maxReports === null) return "Illimités";
  return activeReports
    ? count(limits.maxReports, "rapport actif", "rapports actifs")
    : count(limits.maxReports, "rapport", "rapports");
}

/** AI drafts by the month, or for the whole trial or pass. */
export function draftsCell(limits: PlanLimits): string {
  const parts: string[] = [];
  if (limits.draftsPerMonth !== null) parts.push(`${NUMBER.format(limits.draftsPerMonth)} par mois`);
  if (limits.draftsTotal !== null) parts.push(`${NUMBER.format(limits.draftsTotal)} au total`);
  return parts.length > 0 ? parts.join(", ") : "Illimités";
}

function planName(code: GuidePlanCode): string {
  switch (code) {
    case "trial":
      return `${PLANS.trial.label} (${TRIAL.days} jours)`;
    case "mission":
      return `${PLANS.mission.label} (${OFFERS.mission_pass.days} jours)`;
    case "institution":
      return `${PLANS.institution.label} (sur devis)`;
    default:
      return PLANS[code].label;
  }
}

/** One row of the table: plan, members, reports, AI drafts, custom templates. */
export function planLimitRow(code: GuidePlanCode): string[] {
  const { limits } = PLANS[code];
  const activeReports = code !== "trial" && code !== "mission";
  // The contract of an Institution sets its real quota, as the pricing page says.
  const drafts = code === "institution" ? `${draftsCell(limits)}, ajusté au contrat` : draftsCell(limits);
  return [
    planName(code),
    membersCell(limits),
    reportsCell(limits, { activeReports }),
    drafts,
    limits.customTemplates ? "Oui" : "Non",
  ];
}

/** The table of the FAQ question on limits. */
export function planLimitsTable(): Extract<LegalBlock, { table: unknown }> {
  return {
    table: {
      caption: "Limites de chaque offre",
      head: ["Offre", "Membres", "Rapports", "Brouillons IA", "Modèles personnalisés"],
      rows: GUIDE_PLAN_CODES.map(planLimitRow),
    },
  };
}
