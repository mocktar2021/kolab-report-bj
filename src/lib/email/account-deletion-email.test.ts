import { describe, expect, it } from "vitest";
import { accountDeletionRecordEmail } from "./account-deletion-email";

const input = {
  to: "registre@mocktar.example",
  userId: "3f0c2a1b-5d4e-4f6a-8b7c-9d0e1f2a3b4c",
  deletedAt: new Date("2026-10-15T09:30:12.345Z"),
  environment: "production",
};

describe("accountDeletionRecordEmail", () => {
  it("gives the account id, the UTC date and the environment", () => {
    const email = accountDeletionRecordEmail(input);
    expect(email.to).toBe("registre@mocktar.example");
    expect(email.subject).toBe(
      "[KolabReport production] Compte supprimé 3f0c2a1b-5d4e-4f6a-8b7c-9d0e1f2a3b4c",
    );
    expect(email.text).toContain("Identifiant : 3f0c2a1b-5d4e-4f6a-8b7c-9d0e1f2a3b4c");
    expect(email.text).toContain("Date (UTC) : 2026-10-15T09:30:12.345Z");
    expect(email.html).toContain("3f0c2a1b-5d4e-4f6a-8b7c-9d0e1f2a3b4c");
    expect(email.html).toContain("2026-10-15T09:30:12.345Z");
  });

  it("holds no e-mail address and no name: it has no field for them", () => {
    const email = accountDeletionRecordEmail(input);
    for (const part of [email.subject, email.text, email.html]) {
      expect(part).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(part).not.toContain("registre");
    }
    expect(Object.keys(input).sort()).toEqual(["deletedAt", "environment", "to", "userId"]);
  });

  it("tells the operator what to do with it after a restore", () => {
    expect(accountDeletionRecordEmail(input).text).toContain(
      "Après la restauration d'une sauvegarde prise avant cette date, supprimez de nouveau ce compte",
    );
  });
});
