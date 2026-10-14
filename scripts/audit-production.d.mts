// Types for scripts/audit-production.mjs, so its test can import it.
export type AuditReport = {
  vulnerabilities?: Record<
    string,
    {
      isDirect?: boolean;
      effects?: string[];
      via?: Array<
        string | { source?: number; name?: string; title?: string; url?: string; severity?: string }
      >;
    }
  >;
};

export type AcceptedAdvisory = {
  id: string;
  package?: string;
  via: string[];
  reason: string;
  reviewed: string;
  expires: string;
};

export type Advisory = { id: string; severity: string; title: string; packages: string[]; via: string[] };

export const ACCEPTED_FILE: string;
export function listAdvisories(report: AuditReport): Advisory[];
export function invalidEntries(accepted: unknown): string[];
export function checkReport(
  report: AuditReport,
  accepted: AcceptedAdvisory[],
  today: string,
): { blocking: string[]; notes: string[] };
