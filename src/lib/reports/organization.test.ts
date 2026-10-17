import { describe, expect, it } from "vitest";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { groupOrganizationReports } from "./organization";

function workspace(id: string, name: string): MyWorkspace {
  return {
    id,
    name,
    organizationId: "o-houeze",
    organizationName: "Cabinet Houeze",
    ownsOrganization: false,
    role: "expert",
  };
}

const CARTOGRAPHIE = workspace("w-1", "Cartographie des risques");
const EVALUATION = workspace("w-2", "Évaluation des immobilisations");
const TEST = workspace("w-3", "Test");

type Status = "draft" | "in_review" | "final";

function report(id: string, workspaceId: string, status: Status, createdAt: string) {
  return { id, title: `Rapport ${id}`, status, workspace_id: workspaceId, created_at: createdAt };
}

describe("groupOrganizationReports (KRB-208)", () => {
  it("gives one block per workspace, sorted by name with French rules", () => {
    const result = groupOrganizationReports({
      workspaces: [TEST, EVALUATION, CARTOGRAPHIE],
      reports: [],
      progress: [],
    });
    // "Évaluation" sorts with the E, not after "Test".
    expect(result.workspaces.map((block) => block.workspace.name)).toEqual([
      "Cartographie des risques",
      "Évaluation des immobilisations",
      "Test",
    ]);
    expect(result.workspaces.every((block) => block.reports.length === 0)).toBe(true);
    expect(result).toMatchObject({ total: 0, active: 0 });
  });

  it("puts active reports first, then final ones, the newest first in each", () => {
    const result = groupOrganizationReports({
      workspaces: [CARTOGRAPHIE],
      reports: [
        report("final-new", "w-1", "final", "2026-10-10T09:00:00Z"),
        report("draft-old", "w-1", "draft", "2026-01-05T09:00:00Z"),
        report("review", "w-1", "in_review", "2026-06-01T09:00:00Z"),
        report("final-old", "w-1", "final", "2026-02-01T09:00:00Z"),
      ],
      progress: [],
    });
    expect(result.workspaces[0]!.reports.map((item) => item.id)).toEqual([
      "review",
      "draft-old",
      "final-new",
      "final-old",
    ]);
    expect(result).toMatchObject({ total: 4, active: 2 });
  });

  it("puts each report in its workspace with its completion", () => {
    const result = groupOrganizationReports({
      workspaces: [CARTOGRAPHIE, EVALUATION],
      reports: [
        report("a", "w-1", "draft", "2026-10-01T09:00:00Z"),
        report("b", "w-2", "in_review", "2026-10-02T09:00:00Z"),
      ],
      progress: [
        { report_id: "a", total_sections: 12, completion_percent: 41.5 },
        { report_id: "b", total_sections: null, completion_percent: null },
      ],
    });
    expect(result.workspaces.map((block) => block.reports)).toEqual([
      [
        {
          id: "a",
          title: "Rapport a",
          status: "draft",
          totalSections: 12,
          completionPercent: 41.5,
          createdAt: "2026-10-01T09:00:00Z",
        },
      ],
      [
        {
          id: "b",
          title: "Rapport b",
          status: "in_review",
          totalSections: 0,
          completionPercent: 0,
          createdAt: "2026-10-02T09:00:00Z",
        },
      ],
    ]);
  });

  it("leaves out a report of a workspace the user is not in", () => {
    const result = groupOrganizationReports({
      workspaces: [CARTOGRAPHIE],
      reports: [
        report("mine", "w-1", "draft", "2026-10-01T09:00:00Z"),
        report("other", "w-9", "draft", "2026-10-01T09:00:00Z"),
      ],
      progress: [],
    });
    expect(result.workspaces[0]!.reports.map((item) => item.id)).toEqual(["mine"]);
    expect(result).toMatchObject({ total: 1, active: 1 });
  });
});
