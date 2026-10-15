import { describe, expect, it } from "vitest";
import { organizationDeletedEmail } from "./organization-deleted-email";

const base = {
  to: "admin@kolabreport.test",
  organizationName: "Cabinet Koffi",
  workspaceNames: ["Audit Natitingou", "Mission Kandi"],
  actorName: "Awa Dossou",
  // 14:05 in Cotonou (UTC+1).
  deletedAt: new Date("2026-10-15T13:05:00Z"),
};

describe("organizationDeletedEmail", () => {
  it("says which organization and workspaces went, who deleted them and when", () => {
    const email = organizationDeletedEmail(base);

    expect(email.to).toBe(base.to);
    expect(email.subject).toBe("L'organisation « Cabinet Koffi » a été supprimée");
    expect(email.text).toContain(
      "Awa Dossou a supprimé l'organisation « Cabinet Koffi » le 15 octobre 2026 à 14:05 (heure de Cotonou).",
    );
    expect(email.text).toContain(
      "Ces espaces de travail ont été supprimés avec elle :\n- « Audit Natitingou »\n- « Mission Kandi »",
    );
    expect(email.text).toContain("Leurs rapports, leurs fichiers et leurs exports sont supprimés aussi.");
    expect(email.text).toContain("propriétaire ou administrateur de ces espaces");
    expect(email.text).toContain("support@mocktar.com");
    expect(email.html).toContain('<li style="padding-bottom:4px;">« Mission Kandi »</li>');
    expect(email.html).not.toContain("href=");
  });

  it("speaks of one workspace in the singular", () => {
    const email = organizationDeletedEmail({ ...base, workspaceNames: ["Mission Kandi"] });

    expect(email.text).toContain("Cet espace de travail a été supprimé avec elle :\n- « Mission Kandi »");
    expect(email.text).toContain("Ses rapports, ses fichiers et ses exports sont supprimés aussi.");
    expect(email.text).toContain("propriétaire ou administrateur de cet espace");
  });

  it("names the owner by role when they gave no name, never by e-mail", () => {
    const email = organizationDeletedEmail({ ...base, actorName: "  " });

    expect(email.text).toMatch(
      /^Le propriétaire de l'organisation a supprimé l'organisation « Cabinet Koffi »/,
    );
  });

  it("escapes names in the HTML", () => {
    const email = organizationDeletedEmail({
      ...base,
      organizationName: '<img src=x onerror="alert(1)">',
      workspaceNames: ["<b>Kandi</b>"],
      actorName: "Eve & co",
    });

    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain("<b>Kandi</b>");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(email.html).toContain("Eve &amp; co");
  });
});
