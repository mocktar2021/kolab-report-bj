import { describe, expect, it } from "vitest";
import { allowedReportActions, isReportFrozen, REPORT_TRANSITIONS } from "./status";

describe("REPORT_TRANSITIONS", () => {
  it("matches private.report_status_transitions", () => {
    // Same rows as the first test of supabase/tests/report_workflow_test.sql.
    const rows = Object.values(REPORT_TRANSITIONS)
      .map(({ from, to, roles }) => [from, to, [...roles]])
      .sort((a, b) => `${a[0]}/${a[1]}`.localeCompare(`${b[0]}/${b[1]}`));
    expect(rows).toEqual([
      ["draft", "in_review", ["owner", "admin"]],
      ["final", "draft", ["owner"]],
      ["in_review", "draft", ["owner", "admin"]],
      ["in_review", "final", ["owner"]],
    ]);
  });
});

describe("allowedReportActions", () => {
  it("lets owners and admins submit a draft", () => {
    expect(allowedReportActions("draft", "owner")).toEqual(["submit"]);
    expect(allowedReportActions("draft", "admin")).toEqual(["submit"]);
  });

  it("keeps finalizing and reopening for owners", () => {
    expect(allowedReportActions("in_review", "owner")).toEqual(["sendBack", "finalize"]);
    expect(allowedReportActions("in_review", "admin")).toEqual(["sendBack"]);
    expect(allowedReportActions("final", "owner")).toEqual(["reopen"]);
    expect(allowedReportActions("final", "admin")).toEqual([]);
  });

  it("gives experts and viewers nothing", () => {
    for (const status of ["draft", "in_review", "final"] as const) {
      expect(allowedReportActions(status, "expert")).toEqual([]);
      expect(allowedReportActions(status, "viewer")).toEqual([]);
    }
  });
});

describe("isReportFrozen", () => {
  it("freezes final reports only", () => {
    expect(isReportFrozen("draft")).toBe(false);
    expect(isReportFrozen("in_review")).toBe(false);
    expect(isReportFrozen("final")).toBe(true);
  });
});
