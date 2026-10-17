import { describe, expect, it } from "vitest";
import { OFFERS, PLANS, TRIAL, type PlanLimits } from "@/lib/billing/catalog";
import {
  GUIDE_PLAN_CODES,
  draftsCell,
  membersCell,
  planLimitRow,
  planLimitsTable,
  reportsCell,
} from "./plan-limits";

// The FAQ of the guide (KRB-199) shows the limits of the catalogue, the same
// figures as the pricing page.

const limits = (overrides: Partial<PlanLimits>): PlanLimits => ({
  maxMembers: 3,
  maxReports: 3,
  draftsPerMonth: 60,
  draftsTotal: null,
  customTemplates: false,
  ...overrides,
});

describe("cells", () => {
  it("writes members as a number, or Illimités", () => {
    expect(membersCell(limits({ maxMembers: 10 }))).toBe("10");
    expect(membersCell(limits({ maxMembers: null }))).toBe("Illimités");
  });

  it("counts active reports for subscriptions and every report otherwise", () => {
    expect(reportsCell(limits({ maxReports: 3 }), { activeReports: true })).toBe("3 rapports actifs");
    expect(reportsCell(limits({ maxReports: 1 }), { activeReports: true })).toBe("1 rapport actif");
    expect(reportsCell(limits({ maxReports: 1 }), { activeReports: false })).toBe("1 rapport");
    expect(reportsCell(limits({ maxReports: 2 }), { activeReports: false })).toBe("2 rapports");
    expect(reportsCell(limits({ maxReports: null }), { activeReports: true })).toBe("Illimités");
  });

  it("writes AI drafts by the month or in all, grouped the French way", () => {
    expect(draftsCell(limits({ draftsPerMonth: 1000 }))).toBe("1 000 par mois");
    expect(draftsCell(limits({ draftsPerMonth: null, draftsTotal: 20 }))).toBe("20 au total");
    expect(draftsCell(limits({ draftsPerMonth: 10, draftsTotal: 5 }))).toBe("10 par mois, 5 au total");
    expect(draftsCell(limits({ draftsPerMonth: null, draftsTotal: null }))).toBe("Illimités");
  });
});

describe("planLimitsTable", () => {
  it("has one row per plan of the pricing page, in its order", () => {
    const { table } = planLimitsTable();
    expect(table.head).toHaveLength(5);
    expect(table.rows.map((row) => row[0])).toEqual([
      `${PLANS.trial.label} (${TRIAL.days} jours)`,
      PLANS.independant.label,
      PLANS.cabinet.label,
      `${PLANS.institution.label} (sur devis)`,
      `${PLANS.mission.label} (${OFFERS.mission_pass.days} jours)`,
    ]);
    for (const row of table.rows) expect(row).toHaveLength(table.head.length);
  });

  it.each(GUIDE_PLAN_CODES)("shows the catalogue limits of %s", (code) => {
    const plan: { limits: PlanLimits } = PLANS[code];
    const [, members, reports, drafts, templates] = planLimitRow(code);
    const number = (value: number) => new Intl.NumberFormat("fr-FR").format(value);

    expect(members).toBe(plan.limits.maxMembers === null ? "Illimités" : number(plan.limits.maxMembers));
    if (plan.limits.maxReports === null) expect(reports).toBe("Illimités");
    else expect(reports).toMatch(new RegExp(`^${number(plan.limits.maxReports)} rapports?( |$)`));
    if (plan.limits.draftsPerMonth !== null)
      expect(drafts).toContain(`${number(plan.limits.draftsPerMonth)} par mois`);
    if (plan.limits.draftsTotal !== null)
      expect(drafts).toContain(`${number(plan.limits.draftsTotal)} au total`);
    expect(templates).toBe(plan.limits.customTemplates ? "Oui" : "Non");
  });

  it("counts active reports for the subscriptions only", () => {
    expect(planLimitRow("independant")[2]).toMatch(/actifs?$/);
    expect(planLimitRow("trial")[2]).not.toMatch(/actif/);
    expect(planLimitRow("mission")[2]).not.toMatch(/actif/);
  });

  it("says the contract sets the Institution quota", () => {
    expect(planLimitRow("institution")[3]).toMatch(/ajusté au contrat$/);
  });
});
