import { describe, expect, it } from "vitest";
import {
  createWorkspaceSchema,
  sectionTitleSchema,
  sectionWeightSchema,
  workspaceFieldErrors,
} from "./schemas";

describe("createWorkspaceSchema", () => {
  it("trims the three names", () => {
    const result = createWorkspaceSchema.parse({
      organizationName: "  Cabinet Dossou ",
      workspaceName: "\tAudit 2026\n",
      reportTitle: " Rapport final ",
    });
    expect(result).toEqual({
      organizationName: "Cabinet Dossou",
      workspaceName: "Audit 2026",
      reportTitle: "Rapport final",
    });
  });

  it("reports the first error per field", () => {
    const result = createWorkspaceSchema.safeParse({
      organizationName: "a",
      workspaceName: "x".repeat(121),
      reportTitle: " ",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(workspaceFieldErrors(result.error)).toEqual({
        organizationName: "nameLength",
        workspaceName: "nameLength",
        reportTitle: "titleLength",
      });
    }
  });
});

describe("sectionWeightSchema", () => {
  it("accepts a comma or a dot as decimal separator", () => {
    expect(sectionWeightSchema.parse("2,5")).toBe(2.5);
    expect(sectionWeightSchema.parse(" 3.25 ")).toBe(3.25);
  });

  it("rejects zero, text and values over the column limit", () => {
    expect(sectionWeightSchema.safeParse("0").success).toBe(false);
    expect(sectionWeightSchema.safeParse("abc").success).toBe(false);
    expect(sectionWeightSchema.safeParse("10000").success).toBe(false);
  });
});

describe("sectionTitleSchema", () => {
  it("needs at least one visible character", () => {
    expect(sectionTitleSchema.safeParse("   ").success).toBe(false);
    expect(sectionTitleSchema.parse(" Contexte ")).toBe("Contexte");
  });
});
