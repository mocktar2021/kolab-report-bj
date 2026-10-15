import { describe, expect, it } from "vitest";
import { OFFERS, PLANS } from "./catalog";
import { PRICING_PLANS, planFeatures, planPrices } from "./pricing";

describe("planPrices", () => {
  it("reads every length from the catalogue", () => {
    expect(planPrices("independant")).toEqual({
      month: OFFERS.independant_1m.priceHtXof,
      quarter: OFFERS.independant_3m.priceHtXof,
      year: OFFERS.independant_12m.priceHtXof,
      freeMonths: 2,
      yearSaving: 30_000,
    });
    expect(planPrices("cabinet")).toMatchObject({ month: 49_000, year: 490_000, yearSaving: 98_000 });
  });
});

describe("planFeatures", () => {
  it("lists counts, unlimited limits, templates and free readers", () => {
    expect(planFeatures(PLANS.cabinet.limits, { activeReports: true })).toEqual([
      { key: "members", count: 10 },
      { key: "reportsUnlimited" },
      { key: "draftsPerMonth", count: 250 },
      { key: "customTemplates" },
      { key: "readersFree" },
    ]);
    expect(planFeatures(PLANS.institution.limits, { activeReports: true })[0]).toEqual({
      key: "membersUnlimited",
    });
  });

  it("counts the trial's one report and drafts for the whole trial", () => {
    expect(planFeatures(PLANS.trial.limits, { activeReports: false })).toEqual([
      { key: "members", count: 5 },
      { key: "reports", count: 1 },
      { key: "draftsTotal", count: 20 },
      { key: "customTemplates" },
      { key: "readersFree" },
    ]);
  });

  it("leaves templates out of Indépendant", () => {
    const keys = planFeatures(PLANS.independant.limits, { activeReports: true }).map(
      (feature) => feature.key,
    );
    expect(keys).toEqual(["members", "activeReports", "draftsPerMonth", "readersFree"]);
  });
});

describe("PRICING_PLANS", () => {
  it("shows the trial, the two plans sold online and Institution, readers free on each", () => {
    expect(PRICING_PLANS.map((plan) => plan.code)).toEqual([
      "trial",
      "independant",
      "cabinet",
      "institution",
    ]);
    for (const plan of PRICING_PLANS) {
      expect(plan.features.at(-1)).toEqual({ key: "readersFree" });
    }
  });
});
