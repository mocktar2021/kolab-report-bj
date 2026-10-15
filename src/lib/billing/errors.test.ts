// @vitest-environment node
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/fr.json";
import { PLANS } from "./catalog";
import {
  billingErrorMessage,
  describeWorkspaceError,
  draftQuotaMessage,
  formatBillingDate,
  type BillingLineFacts,
} from "./errors";
import { getBillingOverview, getWorkspaceBillingState } from "./state";

vi.mock("./state", () => ({ getWorkspaceBillingState: vi.fn(), getBillingOverview: vi.fn() }));

const WORKSPACE_ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";
const ORGANIZATION_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";

const independant: BillingLineFacts = {
  billingMode: "subscription",
  plan: "independant",
  limits: PLANS.independant.limits,
  graceEndsAt: "2026-10-08T09:30:00+00:00",
  canManageBilling: true,
};

// Fails on a missing value or a malformed message instead of printing the key.
const strict = {
  onError: (error: Error) => {
    throw error;
  },
};
const workspaces = createTranslator({ locale: "fr", messages, namespace: "Workspaces.errors", ...strict });
const drafts = createTranslator({ locale: "fr", messages, namespace: "AiDraft.errors", ...strict });

describe("formatBillingDate", () => {
  it("writes the day in Porto-Novo time", () => {
    expect(formatBillingDate("2026-11-01T00:00:00Z")).toBe("1 novembre 2026");
    // 23:30 UTC is already the next day in Cotonou (UTC+1).
    expect(formatBillingDate(new Date("2026-10-31T23:30:00Z"))).toBe("1 novembre 2026");
  });
});

describe("billingErrorMessage", () => {
  it("gives the member limit of the plan (KR040)", () => {
    const described = billingErrorMessage("KR040", {}, independant);
    expect(described).toEqual({ error: "seatLimit", values: { plan: "Indépendant", max: 3 } });
    expect(workspaces(described.error, described.values)).toBe(
      "Limite de membres atteinte : l'offre Indépendant compte 3 membres, invitations en attente comprises. Annulez une invitation, retirez un membre ou invitez cette personne comme lecteur, les lecteurs sont gratuits.",
    );
  });

  it("says a viewer can stay one when a role change hits the limit", () => {
    const described = billingErrorMessage("KR040", { roleChange: true }, independant);
    expect(described.error).toBe("seatLimitRole");
    expect(workspaces(described.error, described.values)).toContain("Cette personne peut rester lecteur");
  });

  it("tells the invitee to warn the inviter (KR041), without reading the plan", () => {
    expect(billingErrorMessage("KR041", { invitee: true }, null)).toEqual({ error: "seatLimitInvitee" });
    expect(billingErrorMessage("KR043", { invitee: true }, null)).toEqual({ error: "readOnlyInvitee" });
  });

  it("gives the report limit, reopening included (KR042)", () => {
    const created = billingErrorMessage("KR042", {}, independant);
    expect(created).toEqual({ error: "reportLimit", values: { plan: "Indépendant", max: 3 } });
    expect(workspaces(created.error, created.values)).toBe(
      "Limite de rapports actifs atteinte : l'offre Indépendant en compte 3. Passez un rapport en final ou supprimez-le, ou changez d'offre.",
    );

    const trial: BillingLineFacts = { ...independant, plan: "trial", limits: PLANS.trial.limits };
    const reopened = billingErrorMessage("KR042", { reopen: true }, trial);
    expect(reopened).toEqual({ error: "reportLimitReopen", values: { plan: "Essai gratuit", max: 1 } });
    expect(workspaces(reopened.error, reopened.values)).toBe(
      "Rouvrir ce rapport dépasserait la limite de 1 rapport actif de l'offre Essai gratuit. Passez d'abord un autre rapport en final.",
    );
  });

  it("explains that a pass covers one report", () => {
    const mission: BillingLineFacts = {
      ...independant,
      billingMode: "mission",
      plan: "mission",
      limits: PLANS.mission.limits,
    };
    expect(billingErrorMessage("KR042", {}, mission)).toEqual({ error: "missionReport" });
  });

  it("dates read-only, and tells members who cannot pay to ask (KR043)", () => {
    const owner = billingErrorMessage("KR043", {}, independant);
    expect(owner).toEqual({ error: "readOnly", values: { date: "8 octobre 2026" } });
    expect(workspaces(owner.error, owner.values)).toBe(
      "Cet espace de travail est en lecture seule depuis le 8 octobre 2026. Vous pouvez consulter et exporter les rapports. Renouvelez l'offre pour les modifier.",
    );

    const expert = billingErrorMessage("KR043", {}, { ...independant, canManageBilling: false });
    expect(expert.error).toBe("readOnlyMember");
    expect(workspaces(expert.error, expert.values)).toContain("Demandez au propriétaire de l'organisation");

    const neverPaid = { ...independant, plan: null, graceEndsAt: null };
    expect(billingErrorMessage("KR043", {}, neverPaid)).toEqual({ error: "readOnlyNoPlan" });
  });

  it("names the plans with custom templates (KR044)", () => {
    expect(billingErrorMessage("KR044", {}, null)).toEqual({ error: "templatesNotIncluded" });
  });

  it("falls back to messages without numbers when the plan cannot be read", () => {
    expect(billingErrorMessage("KR040", {}, null)).toEqual({ error: "billingLimit" });
    expect(billingErrorMessage("KR042", {}, null)).toEqual({ error: "billingLimit" });
    expect(billingErrorMessage("KR043", {}, null)).toEqual({ error: "billingReadOnly" });
    const unlimited = { ...independant, plan: "institution" as const, limits: PLANS.institution.limits };
    expect(billingErrorMessage("KR040", {}, unlimited)).toEqual({ error: "billingLimit" });
  });

  it("has a message for every key it gives", () => {
    for (const key of [
      "billingLimit",
      "billingReadOnly",
      "readOnlyNoPlan",
      "readOnlyInvitee",
      "seatLimitInvitee",
    ]) {
      expect(workspaces(key as "billingLimit")).not.toBe(`Workspaces.errors.${key}`);
    }
  });
});

describe("draftQuotaMessage", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const toNextMonth = (Date.parse("2026-11-01T00:00:00Z") - now.getTime()) / 1000;

  it("gives the month's allowance and when it comes back", () => {
    const described = draftQuotaMessage(independant, toNextMonth, now);
    expect(described).toEqual({ error: "quotaExceeded", values: { max: 60, date: "1 novembre 2026" } });
    expect(drafts(described.error, described.values)).toBe(
      "Les 60 brouillons IA du mois sont utilisés. Ajoutez un Pack IA ou attendez le 1 novembre 2026.",
    );
  });

  it("gives the drafts of the trial and of a pass, which do not come back", () => {
    const trial = draftQuotaMessage({ ...independant, plan: "trial", limits: PLANS.trial.limits }, null, now);
    expect(trial).toEqual({ error: "quotaExceededTrial", values: { max: 20 } });
    expect(drafts(trial.error, trial.values)).toBe(
      "Les 20 brouillons IA de l'essai sont utilisés. Choisissez une offre pour continuer.",
    );
    const pass = draftQuotaMessage(
      { billingMode: "mission", plan: "mission", limits: PLANS.mission.limits },
      null,
      now,
    );
    expect(pass).toEqual({ error: "quotaExceededMission", values: { max: 80 } });
  });

  it("falls back to a message without numbers", () => {
    expect(draftQuotaMessage(null, toNextMonth, now)).toEqual({ error: "quotaUsed" });
    expect(draftQuotaMessage(independant, null, now)).toEqual({ error: "quotaUsed" });
    expect(drafts("quotaUsed")).toContain("Pack IA");
  });
});

describe("describeWorkspaceError", () => {
  beforeEach(() => {
    vi.mocked(getWorkspaceBillingState).mockReset();
    vi.mocked(getBillingOverview).mockReset();
  });

  it("maps other errors as before, without reading the plan", async () => {
    expect(await describeWorkspaceError({ code: "KR007" }, { workspaceId: WORKSPACE_ID })).toEqual({
      error: "alreadyMember",
    });
    expect(await describeWorkspaceError(null, { workspaceId: WORKSPACE_ID })).toEqual({ error: "generic" });
    expect(getWorkspaceBillingState).not.toHaveBeenCalled();
  });

  it("reads the plan of the workspace for a billing refusal", async () => {
    vi.mocked(getWorkspaceBillingState).mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      billingMode: "subscription",
      state: "active",
      plan: "independant",
      source: "purchase",
      endsAt: "2026-11-01T09:30:00+00:00",
      graceEndsAt: "2026-11-08T09:30:00+00:00",
      limits: PLANS.independant.limits,
      canReadBilling: true,
      canManageBilling: true,
    });
    expect(await describeWorkspaceError({ code: "KR040" }, { workspaceId: WORKSPACE_ID })).toEqual({
      error: "seatLimit",
      values: { plan: "Indépendant", max: 3 },
    });
    expect(getWorkspaceBillingState).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it("reads the subscription of the organization for a new workspace", async () => {
    vi.mocked(getBillingOverview).mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      enforced: true,
      canManage: false,
      subscription: {
        state: "trialing",
        plan: "trial",
        source: "trial",
        startsAt: "2026-10-01T09:30:00+00:00",
        endsAt: "2026-10-15T09:30:00+00:00",
        graceEndsAt: "2026-10-22T09:30:00+00:00",
        limits: PLANS.trial.limits,
        usage: { members: 2, invitations: 0, activeReports: 1, workspaces: 1 },
        drafts: { used: 3, allowance: 20, period: "total" },
      },
      passes: [],
      packs: [],
      purchases: [],
      purchasesTotal: 0,
      receipts: [],
      receiptsTotal: 0,
    });
    expect(await describeWorkspaceError({ code: "KR042" }, { organizationId: ORGANIZATION_ID })).toEqual({
      error: "reportLimit",
      values: { plan: "Essai gratuit", max: 1 },
    });
  });

  it("does not read the plan for the invitee, who is not a member yet", async () => {
    expect(
      await describeWorkspaceError({ code: "KR043" }, { workspaceId: WORKSPACE_ID, invitee: true }),
    ).toEqual({ error: "readOnlyInvitee" });
    expect(getWorkspaceBillingState).not.toHaveBeenCalled();
  });
});
