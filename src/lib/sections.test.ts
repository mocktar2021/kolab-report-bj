import { describe, expect, it } from "vitest";
import { canEditSection, sectionStatusSchema } from "./sections";

// The dashboard reads ?statut= with this schema and ignores anything else.
describe("sectionStatusSchema", () => {
  it.each(["not_started", "in_progress", "completed"])("accepts %s", (status) => {
    expect(sectionStatusSchema.safeParse(status).success).toBe(true);
  });

  it.each(["", "done", "COMPLETED", "completed;drop table"])("rejects %j", (status) => {
    expect(sectionStatusSchema.safeParse(status).success).toBe(false);
  });
});

describe("canEditSection", () => {
  const me = "00000000-0000-4000-a000-000000000003";
  const someoneElse = "00000000-0000-4000-a000-000000000004";

  it.each(["owner", "admin"] as const)("lets a %s edit any section", (role) => {
    expect(canEditSection({ userId: me, role }, null)).toBe(true);
    expect(canEditSection({ userId: me, role }, someoneElse)).toBe(true);
  });

  it("lets an expert edit only the sections assigned to them", () => {
    expect(canEditSection({ userId: me, role: "expert" }, me)).toBe(true);
    expect(canEditSection({ userId: me, role: "expert" }, someoneElse)).toBe(false);
    expect(canEditSection({ userId: me, role: "expert" }, null)).toBe(false);
  });

  it("never lets a viewer edit, even when assigned", () => {
    expect(canEditSection({ userId: me, role: "viewer" }, me)).toBe(false);
  });
});
