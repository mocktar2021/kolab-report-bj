import { describe, expect, it } from "vitest";
import { sectionStatusSchema } from "./sections";

// The dashboard reads ?statut= with this schema and ignores anything else.
describe("sectionStatusSchema", () => {
  it.each(["not_started", "in_progress", "completed"])("accepts %s", (status) => {
    expect(sectionStatusSchema.safeParse(status).success).toBe(true);
  });

  it.each(["", "done", "COMPLETED", "completed;drop table"])("rejects %j", (status) => {
    expect(sectionStatusSchema.safeParse(status).success).toBe(false);
  });
});
