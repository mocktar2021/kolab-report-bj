import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { PlanCode } from "./catalog";
import { calendarDaysUntil } from "./dates";
import { getWorkspaceBillingState, type WorkspaceBillingState } from "./state";

// What the app shell says about the plan of the current workspace (KRB-178),
// and whether a page may offer edits. Both read public.workspace_billing_state
// once per request and workspace: the layout starts the read early, and the
// page asking about the same workspace gets the same answer without a second
// round trip.

/** workspace_billing_state, once per request and workspace. */
export const readWorkspaceBillingState = cache(getWorkspaceBillingState);

/** The ending banner shows this many calendar days before the end day. */
export const ENDING_SOON_DAYS = 7;

export type BillingBannerState =
  | { kind: "trial"; days: number }
  | { kind: "ending"; plan: PlanCode; endsAt: string }
  | { kind: "grace"; plan: PlanCode; endsAt: string; graceEndsAt: string }
  | { kind: "readOnly"; plan: PlanCode; graceEndsAt: string }
  | { kind: "noPlan" };

export type BillingBanner = BillingBannerState & {
  organizationId: string;
  /** Can buy and renew: sees the link to the billing page. */
  canManage: boolean;
};

/**
 * The banner for a workspace's state, or null when there is nothing to say.
 * Pure. The trial and the end of a period concern only the people who can
 * renew; grace, read-only and no plan concern every member. While billing is
 * not enforced the state is active with no plan, so nothing shows.
 */
export function bannerFor(state: WorkspaceBillingState | null, now: Date = new Date()): BillingBanner | null {
  if (!state) return null;
  const base = { organizationId: state.organizationId, canManage: state.canManageBilling };

  switch (state.state) {
    case "trialing":
      if (!state.canManageBilling || !state.endsAt) return null;
      return { ...base, kind: "trial", days: Math.max(0, calendarDaysUntil(state.endsAt, now)) };
    case "active":
      if (!state.canManageBilling || !state.plan || !state.endsAt) return null;
      if (calendarDaysUntil(state.endsAt, now) > ENDING_SOON_DAYS) return null;
      return { ...base, kind: "ending", plan: state.plan, endsAt: state.endsAt };
    case "grace":
      if (!state.plan || !state.endsAt || !state.graceEndsAt) return null;
      return {
        ...base,
        kind: "grace",
        plan: state.plan,
        endsAt: state.endsAt,
        graceEndsAt: state.graceEndsAt,
      };
    case "read_only":
      if (!state.plan || !state.graceEndsAt) return { ...base, kind: "noPlan" };
      return { ...base, kind: "readOnly", plan: state.plan, graceEndsAt: state.graceEndsAt };
  }
}

/**
 * True when a renewal already follows the period that ends at `endsAt`:
 * workspace_billing_state ignores periods that have not started, so the
 * "ending" banner checks here before showing. Only billing readers can see
 * entitlements (RLS), and only they see that banner.
 */
async function renewedAfter(state: WorkspaceBillingState, workspaceId: string, endsAt: string) {
  const supabase = await createClient();
  let query = supabase
    .from("billing_entitlements")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", state.organizationId)
    .is("revoked_at", null)
    .lte("starts_at", endsAt)
    .gt("ends_at", endsAt);
  query =
    state.billingMode === "mission"
      ? query.eq("scope", "mission").eq("workspace_id", workspaceId)
      : query.eq("scope", "subscription");
  const { count, error } = await query;
  return !error && (count ?? 0) > 0;
}

/**
 * The banner of a workspace for the signed-in user. One cached read of the
 * state; the check for a renewal runs only in the last days of a period,
 * for the people who can renew.
 */
export async function getBillingBanner(workspaceId: string): Promise<BillingBanner | null> {
  const state = await readWorkspaceBillingState(workspaceId);
  const banner = bannerFor(state);
  if (banner?.kind === "ending" && state && (await renewedAfter(state, workspaceId, banner.endsAt))) {
    return null;
  }
  return banner;
}

/** Why a workspace refuses edits, for the notices and the disabled buttons. */
export type ReadOnlyReason = {
  /** When it became read-only. Null when the organization never had a plan. */
  since: string | null;
  canManage: boolean;
  organizationId: string;
};

/** Null while the workspace can be edited. */
export async function getReadOnlyReason(workspaceId: string): Promise<ReadOnlyReason | null> {
  const state = await readWorkspaceBillingState(workspaceId);
  if (!state || state.state !== "read_only") return null;
  return {
    since: state.plan ? state.graceEndsAt : null,
    canManage: state.canManageBilling,
    organizationId: state.organizationId,
  };
}

/**
 * Names of the owners of a workspace: the people a member asks to renew
 * (every workspace owner can buy for the organization). Members read the
 * roster of their workspace (RLS). Only read when a banner asks.
 */
export async function getRenewerNames(workspaceId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("profile:profiles!workspace_members_user_id_fkey(full_name, email)")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner");
  if (error || !data) return [];
  return data
    .map((row) => row.profile?.full_name?.trim() || row.profile?.email || "")
    .filter((name) => name !== "")
    .sort((a, b) => a.localeCompare(b, "fr"));
}
