import "server-only";
import type { DraftErrorKey, DraftErrorValues } from "@/lib/ai/types";
import {
  isBillingError,
  workspaceErrorKey,
  type WorkspaceErrorKey,
  type WorkspaceErrorValues,
} from "@/lib/workspaces/errors";
import { PLANS, type PlanCode, type PlanLimits } from "./catalog";
import { formatBillingDate } from "./format";
import { getBillingOverview, getWorkspaceBillingState, type BillingMode } from "./state";

// The messages of ADR 001, 7.4 for a change the database refused because of
// the organization's plan (KR040 to KR044). The database keeps its messages
// short; the app reads the plan, its limits and its dates with the user's
// rights to say which limit was hit.

export { BILLING_TIME_ZONE, formatBillingDate } from "./format";

/** The billing line a message talks about. */
export type BillingLineFacts = {
  billingMode: BillingMode;
  plan: PlanCode | null;
  limits: PlanLimits;
  /** When the line became read-only, or will. */
  graceEndsAt: string | null;
  canManageBilling: boolean;
};

/** Where the refused change happened, and what it was. */
export type BillingErrorContext = {
  /** The workspace changed. Its members read its state. */
  workspaceId?: string;
  /** For a new workspace: the organization it was added to. Its billing readers read its state. */
  organizationId?: string;
  /** A viewer was given another role. */
  roleChange?: boolean;
  /** A final report was reopened. */
  reopen?: boolean;
  /** Someone accepting an invitation, who is not a member yet. */
  invitee?: boolean;
};

export type DescribedError = { error: WorkspaceErrorKey; values?: WorkspaceErrorValues };

/**
 * The message key, and its numbers, for a billing refusal. Pure: `line` is
 * what the user can read of the plan, null when nothing could be read.
 */
export function billingErrorMessage(
  code: string | null | undefined,
  context: BillingErrorContext,
  line: BillingLineFacts | null,
): DescribedError {
  const fallback = workspaceErrorKey({ code });
  if (code === "KR041" || code === "KR044") return { error: fallback };
  if (code === "KR043" && context.invitee) return { error: "readOnlyInvitee" };
  if (!line) return { error: fallback };

  if (code === "KR043") {
    if (!line.plan || !line.graceEndsAt) return { error: "readOnlyNoPlan" };
    return {
      error: line.canManageBilling ? "readOnly" : "readOnlyMember",
      values: { date: formatBillingDate(line.graceEndsAt) },
    };
  }
  if (!line.plan) return { error: fallback };
  const plan = PLANS[line.plan].label;
  if (code === "KR040") {
    if (line.limits.maxMembers === null) return { error: fallback };
    return {
      error: context.roleChange ? "seatLimitRole" : "seatLimit",
      values: { plan, max: line.limits.maxMembers },
    };
  }
  if (code === "KR042") {
    if (line.billingMode === "mission") return { error: "missionReport" };
    if (line.limits.maxReports === null) return { error: fallback };
    return {
      error: context.reopen ? "reportLimitReopen" : "reportLimit",
      values: { plan, max: line.limits.maxReports },
    };
  }
  return { error: fallback };
}

async function readLine(context: BillingErrorContext): Promise<BillingLineFacts | null> {
  if (context.workspaceId) {
    const state = await getWorkspaceBillingState(context.workspaceId);
    return state
      ? {
          billingMode: state.billingMode,
          plan: state.plan,
          limits: state.limits,
          graceEndsAt: state.graceEndsAt,
          canManageBilling: state.canManageBilling,
        }
      : null;
  }
  if (context.organizationId) {
    const overview = await getBillingOverview(context.organizationId);
    return overview
      ? {
          billingMode: "subscription",
          plan: overview.subscription.plan,
          limits: overview.subscription.limits,
          graceEndsAt: overview.subscription.graceEndsAt,
          canManageBilling: overview.canManage,
        }
      : null;
  }
  return null;
}

/**
 * The message for a draft refused because the AI drafts of the plan are used
 * up (quotaExceeded): the month's allowance comes back on the 1st, the
 * trial's and a pass's never do. Pure, like billingErrorMessage.
 */
export function draftQuotaMessage(
  line: Pick<BillingLineFacts, "billingMode" | "plan" | "limits"> | null,
  retryAfter: number | null,
  now: Date = new Date(),
): { error: DraftErrorKey; values?: DraftErrorValues } {
  if (!line) return { error: "quotaUsed" };
  const { draftsPerMonth, draftsTotal } = line.limits;
  if (draftsTotal !== null) {
    if (line.billingMode === "mission")
      return { error: "quotaExceededMission", values: { max: draftsTotal } };
    if (line.plan === "trial") return { error: "quotaExceededTrial", values: { max: draftsTotal } };
    return { error: "quotaUsed" };
  }
  if (draftsPerMonth !== null && retryAfter !== null) {
    return {
      error: "quotaExceeded",
      values: { max: draftsPerMonth, date: formatBillingDate(new Date(now.getTime() + retryAfter * 1000)) },
    };
  }
  return { error: "quotaUsed" };
}

/** draftQuotaMessage for a workspace, read with the user's rights. */
export async function describeDraftQuota(
  workspaceId: string,
  retryAfter: number | null,
): Promise<{ error: DraftErrorKey; values?: DraftErrorValues }> {
  return draftQuotaMessage(await getWorkspaceBillingState(workspaceId), retryAfter);
}

/**
 * The message for an error from Supabase. Billing refusals read the plan of
 * the workspace (or of the organization, for a new workspace) to fill in
 * {plan}, {max} and {date}; any other error maps as workspaceErrorKey does.
 */
export async function describeWorkspaceError(
  error: { code?: string | null } | null | undefined,
  context: BillingErrorContext,
): Promise<DescribedError> {
  if (!isBillingError(error)) return { error: workspaceErrorKey(error) };
  const needsLine = !context.invitee && error?.code !== "KR041" && error?.code !== "KR044";
  return billingErrorMessage(error?.code, context, needsLine ? await readLine(context) : null);
}
