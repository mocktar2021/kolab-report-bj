import { describe, expect, it } from "vitest";
import { confirmationMatches } from "./confirmation";
import { deletionErrorKey } from "./errors";
import { billingLosses } from "./losses";
import { workspaceAfterDeletion } from "./next-workspace";
import { organizationDeletionRecipients } from "./recipients";

describe("confirmationMatches", () => {
  it("needs the same text, spaces around it aside", () => {
    expect(confirmationMatches("Audit énergétique", "Audit énergétique")).toBe(true);
    expect(confirmationMatches("  Audit énergétique \n", "Audit énergétique")).toBe(true);
    expect(confirmationMatches("Audit énergétique", " Audit énergétique ")).toBe(true);
  });

  it("counts case, accents and the middle of the text", () => {
    expect(confirmationMatches("audit énergétique", "Audit énergétique")).toBe(false);
    expect(confirmationMatches("Audit energetique", "Audit énergétique")).toBe(false);
    expect(confirmationMatches("Audit", "Audit énergétique")).toBe(false);
    expect(confirmationMatches("Audit  énergétique", "Audit énergétique")).toBe(false);
  });

  it("compares accents typed in either Unicode form", () => {
    expect(confirmationMatches("Étude", "Étude")).toBe(true);
    expect(confirmationMatches("Étude", "Étude")).toBe(true);
  });

  it("never matches an empty text, even an empty name", () => {
    expect(confirmationMatches("", "")).toBe(false);
    expect(confirmationMatches("   ", " ")).toBe(false);
  });
});

describe("deletionErrorKey", () => {
  it.each([
    ["42501", "forbidden"],
    ["P0002", "notFound"],
    ["KR070", "confirmation"],
    ["40001", "stale"],
    ["KR071", "paymentPending"],
    ["22P02", "invalidInput"],
    ["XX000", "generic"],
  ])("maps %s to %s", (code, key) => {
    expect(deletionErrorKey({ code })).toBe(key);
  });

  it("falls back to generic without an error code", () => {
    expect(deletionErrorKey(null)).toBe("generic");
    expect(deletionErrorKey({})).toBe("generic");
  });
});

describe("workspaceAfterDeletion", () => {
  const remaining = [
    { id: "w-other-1", organizationId: "org-b" },
    { id: "w-same", organizationId: "org-a" },
    { id: "w-other-2", organizationId: "org-b" },
  ];

  it("prefers a workspace of the same organization", () => {
    expect(workspaceAfterDeletion(remaining, "org-a")).toBe("w-same");
  });

  it("else takes the first one left", () => {
    expect(workspaceAfterDeletion(remaining, "org-c")).toBe("w-other-1");
    expect(workspaceAfterDeletion(remaining, null)).toBe("w-other-1");
  });

  it("answers null when none is left, for the wizard", () => {
    expect(workspaceAfterDeletion([], "org-a")).toBeNull();
  });
});

describe("billingLosses", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const period = (plan: "trial" | "independant" | "cabinet", startsAt: string, endsAt: string) => ({
    entitlementId: `${plan}-${startsAt}`,
    plan,
    startsAt,
    endsAt,
  });

  it("reports nothing lost for an organization with nothing running", () => {
    expect(billingLosses({ subscription: [], passes: [], packs: [] }, now)).toEqual({
      trialEndsAt: null,
      plan: null,
      passes: [],
      packDrafts: 0,
      packsExpireAt: null,
      any: false,
    });
  });

  it("tells a running trial apart: it is not counted as paid time", () => {
    const losses = billingLosses(
      {
        subscription: [period("trial", "2026-10-10T00:00:00+00:00", "2026-10-24T00:00:00+00:00")],
        passes: [],
        packs: [],
      },
      now,
    );
    expect(losses.trialEndsAt).toBe("2026-10-24T00:00:00+00:00");
    expect(losses.plan).toBeNull();
    expect(losses.any).toBe(false);
  });

  it("names the plan running now and the end of the last period paid in advance", () => {
    const losses = billingLosses(
      {
        subscription: [
          period("cabinet", "2026-10-01T00:00:00+00:00", "2026-11-01T00:00:00+00:00"),
          period("independant", "2026-11-01T00:00:00+00:00", "2027-02-01T00:00:00+00:00"),
        ],
        passes: [],
        packs: [],
      },
      now,
    );
    expect(losses.plan).toEqual({ plan: "cabinet", endsAt: "2027-02-01T00:00:00+00:00" });
    expect(losses.any).toBe(true);
  });

  it("keeps the last end of each workspace's passes, and sums the drafts left in packs", () => {
    const losses = billingLosses(
      {
        subscription: [],
        passes: [
          {
            entitlementId: "p1",
            workspaceId: "w1",
            startsAt: "2026-09-01T00:00:00Z",
            endsAt: "2026-11-30T00:00:00Z",
          },
          {
            entitlementId: "p2",
            workspaceId: "w1",
            startsAt: "2026-11-30T00:00:00Z",
            endsAt: "2027-02-28T00:00:00Z",
          },
          {
            entitlementId: "p3",
            workspaceId: "w2",
            startsAt: "2026-10-01T00:00:00Z",
            endsAt: "2026-12-30T00:00:00Z",
          },
        ],
        packs: [
          { packId: "k1", draftsLeft: 70, expiresAt: "2027-06-01T00:00:00Z" },
          { packId: "k2", draftsLeft: 100, expiresAt: "2027-09-01T00:00:00Z" },
        ],
      },
      now,
    );
    expect(losses.passes).toEqual([
      { workspaceId: "w1", endsAt: "2027-02-28T00:00:00Z" },
      { workspaceId: "w2", endsAt: "2026-12-30T00:00:00Z" },
    ]);
    expect(losses.packDrafts).toBe(170);
    expect(losses.packsExpireAt).toBe("2027-09-01T00:00:00Z");
    expect(losses.any).toBe(true);
  });
});

describe("organizationDeletionRecipients", () => {
  const OWNER = "owner";
  const names = new Map([
    ["w1", "Mission Kandi"],
    ["w2", "Audit Natitingou"],
  ]);

  it("tells each owner and admin once, with their own workspaces, but not the person deleting", () => {
    expect(
      organizationDeletionRecipients(
        [
          { user_id: OWNER, workspace_id: "w1", email: "owner@kolabreport.test" },
          { user_id: "paul", workspace_id: "w1", email: "paul@kolabreport.test" },
          { user_id: "paul", workspace_id: "w2", email: "paul@kolabreport.test" },
          { user_id: "awa", workspace_id: "w2", email: "awa@kolabreport.test" },
        ],
        names,
        OWNER,
      ),
    ).toEqual([
      { email: "awa@kolabreport.test", workspaceNames: ["Audit Natitingou"] },
      { email: "paul@kolabreport.test", workspaceNames: ["Audit Natitingou", "Mission Kandi"] },
    ]);
  });

  it("leaves out rows without an e-mail or a workspace of the organization", () => {
    expect(
      organizationDeletionRecipients(
        [
          { user_id: "paul", workspace_id: "w1", email: null },
          { user_id: "awa", workspace_id: "w9", email: "awa@kolabreport.test" },
          { user_id: "eve", workspace_id: "w1", email: "  " },
        ],
        names,
        OWNER,
      ),
    ).toEqual([]);
  });
});
