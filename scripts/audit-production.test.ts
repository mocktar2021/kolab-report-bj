import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_FILE,
  checkReport,
  invalidEntries,
  listAdvisories,
  type AcceptedAdvisory,
  type AuditReport,
} from "./audit-production.mjs";

// The shape of `npm audit --omit=dev --json` (auditReportVersion 2), cut
// down to what the script reads: braces is vulnerable and reaches the app
// through micromatch, fast-glob and next-pwa; uuid is a moderate one.
function report(extraEffects: string[] = []): AuditReport {
  return {
    vulnerabilities: {
      braces: {
        isDirect: false,
        effects: ["micromatch"],
        via: [
          {
            source: 1,
            name: "braces",
            title: " braces vulnerable to stack-exhaustion denial of service",
            url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
            severity: "high",
          },
        ],
      },
      micromatch: { isDirect: false, effects: ["fast-glob"], via: ["braces"] },
      "fast-glob": {
        isDirect: false,
        effects: ["@ducanh2912/next-pwa", ...extraEffects],
        via: ["micromatch"],
      },
      "@ducanh2912/next-pwa": { isDirect: true, effects: [], via: ["fast-glob"] },
      "some-runtime-lib": { isDirect: true, effects: [], via: ["fast-glob"] },
      uuid: {
        isDirect: false,
        effects: ["exceljs"],
        via: [
          {
            source: 2,
            name: "uuid",
            title: "uuid: Missing buffer bounds check",
            url: "https://github.com/advisories/GHSA-w5hq-g745-h8pq",
            severity: "moderate",
          },
        ],
      },
      exceljs: { isDirect: true, effects: [], via: ["uuid"] },
    },
  };
}

const accepted: AcceptedAdvisory[] = [
  {
    id: "GHSA-vfj7-8cjw-p6xm",
    package: "braces",
    via: ["@ducanh2912/next-pwa"],
    reason: "Only globs fixed patterns during next build.",
    reviewed: "2026-10-14",
    expires: "2027-01-14",
  },
];

describe("listAdvisories", () => {
  it("gives one entry per GHSA with the direct dependencies it comes through", () => {
    expect(listAdvisories(report())).toEqual([
      {
        id: "GHSA-vfj7-8cjw-p6xm",
        severity: "high",
        title: "braces vulnerable to stack-exhaustion denial of service",
        packages: ["braces"],
        via: ["@ducanh2912/next-pwa"],
      },
      {
        id: "GHSA-w5hq-g745-h8pq",
        severity: "moderate",
        title: "uuid: Missing buffer bounds check",
        packages: ["uuid"],
        via: ["exceljs"],
      },
    ]);
  });
});

describe("checkReport", () => {
  it("passes an accepted advisory and ignores moderate ones", () => {
    const result = checkReport(report(), accepted, "2026-10-14");
    expect(result.blocking).toEqual([]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain("Accepted until 2027-01-14");
  });

  it("blocks a high advisory that is not on the list", () => {
    const result = checkReport(report(), [], "2026-10-14");
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]).toContain("GHSA-vfj7-8cjw-p6xm");
    expect(result.blocking[0]).toContain(ACCEPTED_FILE);
  });

  it("blocks once the review has expired", () => {
    const result = checkReport(report(), accepted, "2027-01-15");
    expect(result.blocking[0]).toContain("expired on 2027-01-14");
  });

  it("blocks when the advisory comes through a direct dependency the review did not cover", () => {
    const result = checkReport(report(["some-runtime-lib"]), accepted, "2026-10-14");
    expect(result.blocking[0]).toContain("now also comes through some-runtime-lib");
  });

  it("notes an accepted advisory that is no longer reported", () => {
    const result = checkReport({ vulnerabilities: {} }, accepted, "2026-10-14");
    expect(result.blocking).toEqual([]);
    expect(result.notes[0]).toContain("no longer reported");
  });
});

describe("invalidEntries", () => {
  it("accepts the list in the repository", () => {
    expect(invalidEntries(JSON.parse(readFileSync(ACCEPTED_FILE, "utf8")))).toEqual([]);
  });

  it("requires every field", () => {
    expect(invalidEntries({})).toEqual([`${ACCEPTED_FILE} must be a JSON array`]);
    const problems = invalidEntries([{ id: "CVE-1", via: [], reason: "ok", reviewed: "soon" }]);
    expect(problems).toHaveLength(5);
  });
});
