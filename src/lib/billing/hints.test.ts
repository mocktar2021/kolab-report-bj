// @vitest-environment node
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../messages/fr.json";
import { draftsHintText, membersHintText, reportsHintText } from "./hints";
import type { WorkspaceUsage } from "./state";

// The server translator, with the real French messages. Fails on a missing
// value or a malformed message instead of printing the key.
vi.mock("next-intl/server", () => ({
  getTranslations: (namespace: "Billing.meter") =>
    Promise.resolve(
      createTranslator({
        locale: "fr",
        messages,
        namespace,
        onError: (error) => {
          throw error;
        },
      }),
    ),
}));

const USAGE: WorkspaceUsage = {
  billingMode: "subscription",
  enforced: true,
  state: "active",
  plan: "independant",
  members: 3,
  invitations: 0,
  maxMembers: 3,
  reports: 1,
  maxReports: 3,
  drafts: { used: 48, allowance: 60, period: "month" },
  packDraftsLeft: 0,
};

describe("membersHintText", () => {
  it("says how many members the plan counts", async () => {
    expect(await membersHintText(USAGE)).toBe(
      "Offre Indépendant : 3 membres sur 3. Les lecteurs sont gratuits.",
    );
    expect(await membersHintText({ ...USAGE, members: 1, invitations: 2 })).toBe(
      "Offre Indépendant : 1 membre + 2 invitations sur 3. Les lecteurs sont gratuits.",
    );
    expect(
      await membersHintText({
        ...USAGE,
        billingMode: "mission",
        plan: "mission",
        members: 2,
        maxMembers: 10,
      }),
    ).toBe("Pass Mission : 2 membres sur 10. Les lecteurs sont gratuits.");
    expect(await membersHintText({ ...USAGE, enforced: false })).toBeNull();
  });
});

describe("reportsHintText", () => {
  it("counts the active reports", async () => {
    expect(await reportsHintText(USAGE)).toBe(
      "Offre Indépendant : 1 rapport actif sur 3. Un rapport final ne compte plus.",
    );
    expect(await reportsHintText({ ...USAGE, reports: 0 })).toBe(
      "Offre Indépendant : aucun rapport actif sur 3. Un rapport final ne compte plus.",
    );
    expect(
      await reportsHintText({ ...USAGE, billingMode: "mission", plan: "mission", reports: 1, maxReports: 1 }),
    ).toBe(
      "Un Pass Mission couvre un seul rapport. Créez un nouvel espace de travail pour une autre mission.",
    );
  });
});

describe("draftsHintText", () => {
  it("says what is left this month, in the trial or in the pass", async () => {
    expect(await draftsHintText(USAGE)).toBe("12 brouillons IA restants ce mois-ci.");
    expect(await draftsHintText({ ...USAGE, drafts: { used: 59, allowance: 60, period: "month" } })).toBe(
      "1 brouillon IA restant ce mois-ci.",
    );
    expect(
      await draftsHintText({ ...USAGE, plan: "trial", drafts: { used: 20, allowance: 20, period: "total" } }),
    ).toBe("Aucun brouillon IA restant pour l'essai.");
    expect(
      await draftsHintText({
        ...USAGE,
        billingMode: "mission",
        plan: "mission",
        drafts: { used: 10, allowance: 80, period: "total" },
      }),
    ).toBe("70 brouillons IA restants pour ce Pass Mission.");
  });

  it("adds the packs", async () => {
    expect(await draftsHintText({ ...USAGE, packDraftsLeft: 100 })).toBe(
      "12 brouillons IA restants ce mois-ci, plus 100 brouillons IA de Packs IA.",
    );
  });
});
