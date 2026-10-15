import { afterEach, describe, expect, it, vi } from "vitest";
import { PLANS } from "../../src/lib/billing/catalog";
import {
  PLAN_LIMITS,
  grantParams,
  limitsFrom,
  parseArgs,
  recordPaymentParams,
  revokeParams,
  run,
  target,
} from "./admin.mjs";

const ORG = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";
const ENV = { SUPABASE_URL: "https://project.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "service-key" };

const args = (line: string) => parseArgs(line.split(" "));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PLAN_LIMITS", () => {
  it("are the limits of the catalogue", () => {
    for (const plan of ["independant", "cabinet", "institution"] as const) {
      const { limits } = PLANS[plan];
      expect(PLAN_LIMITS[plan], plan).toEqual({
        max_members: limits.maxMembers,
        max_reports: limits.maxReports,
        drafts_per_month: limits.draftsPerMonth,
        drafts_total: limits.draftsTotal,
        custom_templates: limits.customTemplates,
      });
    }
  });
});

describe("parseArgs", () => {
  it("reads values and flags", () => {
    expect(parseArgs(["--organization", ORG, "--test", "--apply"])).toEqual({
      organization: ORG,
      test: true,
      apply: true,
    });
  });

  it("refuses a stray word", () => {
    expect(() => parseArgs(["oops"])).toThrow("Unexpected argument: oops");
  });
});

describe("limitsFrom", () => {
  it("starts from the plan and changes what is given, none meaning no limit", () => {
    expect(
      limitsFrom("cabinet", { members: "25", reports: "none", "drafts-per-month": "400", templates: "no" }),
    ).toEqual({
      max_members: 25,
      max_reports: null,
      drafts_per_month: 400,
      drafts_total: null,
      custom_templates: false,
    });
    expect(limitsFrom("institution", {})).toEqual(PLAN_LIMITS.institution);
  });

  it("refuses limits the database would refuse", () => {
    expect(() => limitsFrom("cabinet", { members: "0" })).toThrow("--members must be between 1");
    expect(() => limitsFrom("cabinet", { templates: "maybe" })).toThrow("--templates must be yes or no");
  });
});

describe("recordPaymentParams", () => {
  const line = `--organization ${ORG} --amount 1_800_000 --reference VIR-0147 --paid-on 2026-10-13 --actor Mocktar --reason Devis`;

  it("builds the call with Institution limits, 12 months and a real receipt by default", () => {
    expect(recordPaymentParams(args(line))).toEqual({
      p_organization_id: ORG,
      p_amount_ht_xof: 1_800_000,
      p_months: 12,
      p_limits: PLAN_LIMITS.institution,
      p_transfer_reference: "VIR-0147",
      p_paid_at: "2026-10-13T12:00:00+01:00",
      p_actor: "Mocktar",
      p_reason: "Devis",
      p_label: null,
      p_catalog_version: 1,
      p_test: false,
    });
  });

  it("takes the length, the limits and the test flag", () => {
    expect(recordPaymentParams(args(`${line} --months 24 --drafts-per-month 2000 --test`))).toMatchObject({
      p_months: 24,
      p_limits: { drafts_per_month: 2000 },
      p_test: true,
    });
  });

  it("names what is missing or wrong", () => {
    expect(() => recordPaymentParams(args(line.replace(" --actor Mocktar", "")))).toThrow(
      "--actor is required",
    );
    expect(() =>
      recordPaymentParams(args(line.replace("--paid-on 2026-10-13", "--paid-on 13/10/2026"))),
    ).toThrow("--paid-on must be a date");
    expect(() => recordPaymentParams(args(line.replace(ORG, "org-1")))).toThrow(
      "--organization must be a uuid",
    );
    expect(() => recordPaymentParams(args(`${line} --months 40`))).toThrow(
      "--months must be between 1 and 36",
    );
  });
});

describe("grantParams", () => {
  const line = `--organization ${ORG} --plan institution --actor Mocktar --reason Propriétaire`;

  it("takes a length in days or months and an optional start", () => {
    expect(grantParams(args(`${line} --months 12`))).toEqual({
      p_organization_id: ORG,
      p_plan: "institution",
      p_length: "12 months",
      p_limits: PLAN_LIMITS.institution,
      p_actor: "Mocktar",
      p_reason: "Propriétaire",
      p_starts_at: null,
    });
    expect(grantParams(args(`${line} --days 30 --start 2026-11-01`))).toMatchObject({
      p_length: "30 days",
      p_starts_at: "2026-11-01T12:00:00+01:00",
    });
  });

  it("refuses the trial, and a length given twice or not at all", () => {
    expect(() => grantParams(args(`${line.replace("institution", "trial")} --days 30`))).toThrow(
      "--plan must be",
    );
    expect(() => grantParams(args(line))).toThrow("Give either --days or --months");
    expect(() => grantParams(args(`${line} --days 30 --months 1`))).toThrow("Give either --days or --months");
  });
});

describe("revokeParams", () => {
  it("needs the entitlement, an actor and a reason", () => {
    expect(revokeParams(args(`--entitlement ${ORG} --actor Mocktar --reason Erreur`))).toEqual({
      p_entitlement_id: ORG,
      p_actor: "Mocktar",
      p_reason: "Erreur",
    });
    expect(() => revokeParams(args(`--entitlement ${ORG} --actor Mocktar`))).toThrow("--reason is required");
  });
});

describe("target", () => {
  it("reads the URL and the service role key", () => {
    expect(target(ENV)).toEqual({ url: "https://project.supabase.co", key: "service-key" });
    expect(() => target({ SUPABASE_URL: "https://project.supabase.co" })).toThrow(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
  });
});

describe("run", () => {
  const options = (argv: string) => ({
    argv: argv.split(" "),
    env: ENV,
    build: revokeParams,
    functionName: "billing_admin_revoke",
    describe: async () => {},
    log: vi.fn(),
  });

  it("writes nothing without --apply", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const opts = options(`--entitlement ${ORG} --actor Mocktar --reason Erreur`);
    await expect(run(opts)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(opts.log).toHaveBeenCalledWith("Dry run: nothing written. Run again with --apply to write.");
  });

  it("calls the function with the service role on --apply", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify([{ entitlement_id: ORG }]), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      run(options(`--entitlement ${ORG} --actor Mocktar --reason Erreur --apply`)),
    ).resolves.toEqual([{ entitlement_id: ORG }]);
    expect(fetch).toHaveBeenCalledWith(
      "https://project.supabase.co/rest/v1/rpc/billing_admin_revoke",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ p_entitlement_id: ORG, p_actor: "Mocktar", p_reason: "Erreur" }),
        headers: expect.objectContaining({ apikey: "service-key", Authorization: "Bearer service-key" }),
      }),
    );
  });

  it("passes on the database's refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "Unknown entitlement" }), { status: 400 })),
    );
    await expect(
      run(options(`--entitlement ${ORG} --actor Mocktar --reason Erreur --apply`)),
    ).rejects.toThrow("Supabase answered 400: Unknown entitlement");
  });
});
