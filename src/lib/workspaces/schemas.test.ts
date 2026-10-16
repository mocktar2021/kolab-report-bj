import { describe, expect, it } from "vitest";
import {
  createReportSchema,
  createWorkspaceInOrganizationSchema,
  createWorkspaceSchema,
  sectionInstructionsSchema,
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

describe("createWorkspaceInOrganizationSchema", () => {
  const organizationId = "00000000-0000-4000-b000-000000000001";

  it("takes the organization id instead of a name and trims the other names", () => {
    const result = createWorkspaceInOrganizationSchema.parse({
      organizationId,
      organizationName: "ignored",
      workspaceName: " Mission Cotonou ",
      reportTitle: "\nRapport Cotonou\t",
    });
    expect(result).toEqual({
      organizationId,
      workspaceName: "Mission Cotonou",
      reportTitle: "Rapport Cotonou",
    });
  });

  it("rejects an id that is not a uuid", () => {
    const result = createWorkspaceInOrganizationSchema.safeParse({
      organizationId: "cabinet-dossou",
      workspaceName: "Mission Cotonou",
      reportTitle: "Rapport Cotonou",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(["organizationId"]);
    }
  });

  it("checks the workspace name and the report title like the first wizard", () => {
    const result = createWorkspaceInOrganizationSchema.safeParse({
      organizationId,
      workspaceName: " a ",
      reportTitle: "x".repeat(201),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(workspaceFieldErrors(result.error)).toEqual({
        workspaceName: "nameLength",
        reportTitle: "titleLength",
      });
    }
  });
});

describe("createReportSchema", () => {
  const workspaceId = "00000000-0000-4000-c000-000000000001";

  it("trims the title", () => {
    expect(createReportSchema.parse({ workspaceId, title: "  Rapport annuel 2026 " })).toEqual({
      workspaceId,
      title: "Rapport annuel 2026",
    });
  });

  it("needs a title between 2 and 200 characters", () => {
    for (const title of [" a ", "", "x".repeat(201)]) {
      const result = createReportSchema.safeParse({ workspaceId, title });
      expect(result.success).toBe(false);
      if (!result.success) expect(workspaceFieldErrors(result.error)).toEqual({ title: "titleLength" });
    }
    expect(createReportSchema.safeParse({ workspaceId, title: "x".repeat(200) }).success).toBe(true);
  });

  it("rejects a workspace id that is not a uuid", () => {
    const result = createReportSchema.safeParse({ workspaceId: "w1", title: "Rapport annuel" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(["workspaceId"]);
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

describe("sectionInstructionsSchema", () => {
  it("counts a posted line break once, as the field does", () => {
    const lines = Array.from({ length: 21 }, () => "a".repeat(189));
    const posted = lines.join("\r\n");
    expect(lines.join("\n")).toHaveLength(3989);
    expect(posted).toHaveLength(4009);
    expect(sectionInstructionsSchema.parse(posted)).toBe(lines.join("\n"));
  });

  it("holds at most 4000 characters", () => {
    expect(sectionInstructionsSchema.safeParse("a".repeat(4000)).success).toBe(true);
    expect(sectionInstructionsSchema.safeParse("a".repeat(4001)).error?.issues[0]?.message).toBe(
      "instructionsLength",
    );
  });
});
