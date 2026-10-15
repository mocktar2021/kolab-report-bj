// Types for scripts/billing/admin.mjs, so its test can import it.
type Limits = {
  max_members: number | null;
  max_reports: number | null;
  drafts_per_month: number | null;
  drafts_total: number | null;
  custom_templates: boolean;
};
type Args = Record<string, string | true>;
type Env = Record<string, string | undefined>;
type Project = { url: string; key: string };
type Period = { id: string; plan: string; source: string; starts_at: string; ends_at: string };
type Log = (line: string) => void;

export const PLAN_LIMITS: Record<"independant" | "cabinet" | "institution", Limits>;
export function parseArgs(argv: string[]): Args;
export function limitsFrom(plan: keyof typeof PLAN_LIMITS, args: Args): Limits;
export function recordPaymentParams(args: Args): {
  p_organization_id: string;
  p_amount_ht_xof: number;
  p_months: number;
  p_limits: Limits;
  p_transfer_reference: string;
  p_paid_at: string;
  p_actor: string;
  p_reason: string;
  p_label: string | null;
  p_catalog_version: number;
  p_test: boolean;
};
export function grantParams(args: Args): {
  p_organization_id: string;
  p_plan: string;
  p_length: string;
  p_limits: Limits;
  p_actor: string;
  p_reason: string;
  p_starts_at: string | null;
};
export function revokeParams(args: Args): { p_entitlement_id: string; p_actor: string; p_reason: string };
export function target(env: Env): Project;
export function callFunction(project: Project, name: string, params: object): Promise<unknown>;
export function organizationSummary(
  project: Project,
  organizationId: string,
  now?: Date,
): Promise<{ name: string; periods: Period[] }>;
export function formatPeriods(periods: Period[]): string[];
export function run<P extends object>(options: {
  argv: string[];
  env: Env;
  build: (args: Args) => P;
  functionName: string;
  describe: (project: Project, params: P, log: Log) => Promise<void>;
  log?: Log;
}): Promise<unknown>;
