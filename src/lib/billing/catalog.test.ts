// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OFFERS as CGV_OFFERS } from "@/content/legal/cgv";
import { PUBLISHER } from "@/content/legal/publisher";
import {
  GRACE_DAYS,
  INSTITUTION,
  isOfferCode,
  OFFER_CODES,
  OFFERS,
  offerAmountHtXof,
  PLAN_CODES,
  PLANS,
  TRIAL,
  YEAR_PAID_MONTHS,
} from "./catalog";

// The database starts trials and copies limits on its own, so parts of the
// catalogue are written again in SQL. These tests read the migration file and
// fail when the two differ. billing_trial_test.sql pins the same values in
// the database.
const MIGRATION = readFileSync(
  new URL("../../../supabase/migrations/20261015100000_billing_entitlements.sql", import.meta.url),
  "utf8",
);

/** Body of a SQL function of the migration, between its $$ quotes. */
function functionBody(name: string): string {
  const start = MIGRATION.indexOf(`create or replace function ${name}(`);
  expect(start, `${name} is in the migration`).toBeGreaterThanOrEqual(0);
  const open = MIGRATION.indexOf("$$", start);
  const close = MIGRATION.indexOf("$$", open + 2);
  return MIGRATION.slice(open + 2, close);
}

/** First group of `pattern` in the migration. Fails the test when it is not there. */
function captured(pattern: RegExp): string {
  const group = MIGRATION.match(pattern)?.[1];
  if (group === undefined) throw new Error(`${pattern} is not in the migration`);
  return group;
}

describe("private.billing_trial_terms()", () => {
  it("matches the trial of the catalogue", () => {
    const terms = Object.fromEntries(
      [...functionBody("private.billing_trial_terms").matchAll(/^\s*(\S+) as (\w+)[,;]?$/gm)].map(
        ([, value, name]) => [name, value],
      ),
    );
    expect(terms).toEqual({
      days: String(TRIAL.days),
      max_members: String(TRIAL.limits.maxMembers),
      max_reports: String(TRIAL.limits.maxReports),
      drafts_total: String(TRIAL.limits.draftsTotal),
      custom_templates: String(TRIAL.limits.customTemplates),
    });
    // The trial has one allowance for its whole length, never a monthly one.
    expect(TRIAL.limits.draftsPerMonth).toBeNull();
  });
});

describe("public.billing_entitlements", () => {
  it("takes the plans of the catalogue", () => {
    const plans = captured(/plan\s+text not null check \(plan in \(([^)]*)\)\)/)
      .split(",")
      .map((code) => code.trim().replace(/^'|'$/g, ""));
    expect(plans).toEqual([...PLAN_CODES]);
  });

  it("gives every entitlement the grace of the catalogue", () => {
    expect(MIGRATION).toMatch(new RegExp(`grace_days\\s+smallint not null default ${GRACE_DAYS} `));
  });
});

describe("private.billing_settings", () => {
  it("names the seller of the legal pages", () => {
    expect(JSON.parse(captured(/'(\{"name": [^']*\})'::jsonb/))).toEqual({
      name: PUBLISHER.name,
      legal_form: PUBLISHER.legalForm,
      address: PUBLISHER.address,
      rccm: PUBLISHER.rccm,
      ifu: PUBLISHER.ifu,
      email: PUBLISHER.email,
    });
  });
});

describe("plans", () => {
  it("has one entry per plan code", () => {
    expect(Object.keys(PLANS)).toEqual([...PLAN_CODES]);
    for (const code of PLAN_CODES) expect(PLANS[code].code).toBe(code);
  });

  it("keeps one kind of AI allowance per plan", () => {
    for (const { limits } of Object.values(PLANS)) {
      expect(limits.draftsPerMonth === null || limits.draftsTotal === null).toBe(true);
    }
  });

  it("matches the offers of the CGV", () => {
    expect(TRIAL.days).toBe(CGV_OFFERS.trial.days);
    expect(PLANS.trial.limits).toMatchObject({
      maxMembers: CGV_OFFERS.trial.members,
      maxReports: CGV_OFFERS.trial.reports,
      draftsTotal: CGV_OFFERS.trial.aiDrafts,
    });
    expect(PLANS.independant.monthlyPriceHtXof).toBe(CGV_OFFERS.independant.monthly);
    expect(PLANS.independant.limits).toMatchObject({
      maxMembers: CGV_OFFERS.independant.members,
      maxReports: CGV_OFFERS.independant.activeReports,
      draftsPerMonth: CGV_OFFERS.independant.aiDraftsPerMonth,
    });
    expect(PLANS.cabinet.monthlyPriceHtXof).toBe(CGV_OFFERS.cabinet.monthly);
    expect(PLANS.cabinet.limits).toMatchObject({
      maxMembers: CGV_OFFERS.cabinet.members,
      maxReports: null,
      draftsPerMonth: CGV_OFFERS.cabinet.aiDraftsPerMonth,
    });
    expect(INSTITUTION.fromMonthlyPriceHtXof).toBe(CGV_OFFERS.institution.fromMonthly);
    expect(OFFERS.mission_pass).toMatchObject({
      priceHtXof: CGV_OFFERS.passMission.price,
      days: CGV_OFFERS.passMission.days,
    });
    expect(PLANS.mission.limits).toMatchObject({
      maxMembers: CGV_OFFERS.passMission.members,
      maxReports: 1,
      draftsTotal: CGV_OFFERS.passMission.aiDrafts,
    });
    expect(OFFERS.ai_pack_100).toMatchObject({
      priceHtXof: CGV_OFFERS.packIa.price,
      drafts: CGV_OFFERS.packIa.aiDrafts,
    });
    expect(GRACE_DAYS).toBe(CGV_OFFERS.graceDays);
  });

  it("puts custom templates in the trial, Cabinet and Institution only", () => {
    const withTemplates = PLAN_CODES.filter((code) => PLANS[code].limits.customTemplates);
    expect(withTemplates).toEqual(["trial", "cabinet", "institution"]);
  });
});

describe("offers", () => {
  it("has one entry per offer code", () => {
    expect(Object.keys(OFFERS)).toEqual([...OFFER_CODES]);
    for (const code of OFFER_CODES) expect(OFFERS[code].code).toBe(code);
  });

  it("charges a quarter 3 months and a year 10 months", () => {
    for (const plan of ["independant", "cabinet"] as const) {
      const monthly = PLANS[plan].monthlyPriceHtXof;
      expect(OFFERS[`${plan}_1m`].priceHtXof).toBe(monthly);
      expect(OFFERS[`${plan}_3m`].priceHtXof).toBe(3 * monthly);
      expect(OFFERS[`${plan}_12m`].priceHtXof).toBe(YEAR_PAID_MONTHS * monthly);
      expect(YEAR_PAID_MONTHS).toBe(10);
    }
  });

  it("gives every offer a French label naming its plan", () => {
    for (const offer of Object.values(OFFERS)) {
      expect(offer.label.length).toBeGreaterThan(2);
      if (offer.kind === "subscription") {
        expect(offer.label).toBe(`${PLANS[offer.plan].label}, ${offer.months} mois`);
      }
    }
    expect(OFFERS.mission_pass.label).toContain(PLANS.mission.label);
    expect(OFFERS.ai_pack_100.label).toContain("Pack IA");
  });

  it("computes amounts from the catalogue only", () => {
    expect(offerAmountHtXof("cabinet_12m")).toBe(490_000);
    expect(offerAmountHtXof("mission_pass")).toBe(39_000);
    expect(offerAmountHtXof("ai_pack_100", 3)).toBe(36_000);
    expect(offerAmountHtXof("ai_pack_100", 10)).toBe(120_000);
  });

  it("refuses quantities outside 1 to 10 packs, and more than one plan", () => {
    expect(() => offerAmountHtXof("ai_pack_100", 0)).toThrow(RangeError);
    expect(() => offerAmountHtXof("ai_pack_100", 11)).toThrow(RangeError);
    expect(() => offerAmountHtXof("ai_pack_100", 1.5)).toThrow(RangeError);
    expect(() => offerAmountHtXof("cabinet_1m", 2)).toThrow(RangeError);
  });

  it("recognizes offer codes", () => {
    expect(isOfferCode("cabinet_3m")).toBe(true);
    expect(isOfferCode("institution")).toBe(false);
    expect(isOfferCode(15_000)).toBe(false);
  });
});
