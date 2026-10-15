import "server-only";
import { z } from "zod";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { PLAN_CODES, type PlanCode, type PlanLimits } from "./catalog";

// Typed wrappers of public.workspace_billing_state and public.billing_overview
// (supabase/migrations/20261015100000_billing_entitlements.sql). Both run with
// the signed-in user's rights: members read the state of their workspace,
// billing readers (organization owner, owners and admins of its workspaces)
// read the overview of their organization. Counts, dates and limits only, no
// name, e-mail or amount.
//
// While billing is not enforced, every workspace reads as active with no
// limit, so nothing in the app changes before the launch.

export const BILLING_STATES = ["trialing", "active", "grace", "read_only"] as const;

export type BillingState = (typeof BILLING_STATES)[number];

export type BillingMode = "subscription" | "mission";

export type EntitlementSource = "trial" | "purchase" | "manual" | "launch";

export type WorkspaceBillingState = {
  organizationId: string;
  billingMode: BillingMode;
  state: BillingState;
  /** Null when the line never had an entitlement, and while billing is not enforced. */
  plan: PlanCode | null;
  source: EntitlementSource | null;
  endsAt: string | null;
  /** When a workspace in grace becomes read-only, or became read-only. */
  graceEndsAt: string | null;
  limits: PlanLimits;
  /** Can see the organization's billing page. */
  canReadBilling: boolean;
  /** Can buy and renew for the organization. */
  canManageBilling: boolean;
};

export type BillingLine = {
  state: BillingState;
  plan: PlanCode | null;
  source: EntitlementSource | null;
  startsAt: string | null;
  endsAt: string | null;
  graceEndsAt: string | null;
  limits: PlanLimits;
};

export type BillingOverview = {
  organizationId: string;
  enforced: boolean;
  canManage: boolean;
  subscription: BillingLine & {
    usage: {
      /** Distinct people with a non-viewer role in the subscription's workspaces. */
      members: number;
      /** Open invitations with a non-viewer role, to people who are not members yet. */
      invitations: number;
      /** Draft and in-review reports. */
      activeReports: number;
      workspaces: number;
    };
  };
  /** One per mission workspace, oldest first. */
  passes: (BillingLine & {
    workspaceId: string;
    usage: { members: number; invitations: number; reports: number };
  })[];
  /** Running packs, the one that expires first first. */
  packs: { id: string; drafts: number; expiresAt: string }[];
};

const stateSchema = z.enum(BILLING_STATES);
const planSchema = z.enum(PLAN_CODES).nullable();
const sourceSchema = z.enum(["trial", "purchase", "manual", "launch"]).nullable();
const countSchema = z.number().int().nonnegative();
const limitSchema = countSchema.nullable();

const workspaceRowSchema = z.object({
  organization_id: z.string(),
  billing_mode: z.enum(["subscription", "mission"]),
  state: stateSchema,
  plan: planSchema,
  source: sourceSchema,
  ends_at: z.string().nullable(),
  grace_ends_at: z.string().nullable(),
  max_members: limitSchema,
  max_reports: limitSchema,
  drafts_per_month: limitSchema,
  drafts_total: limitSchema,
  custom_templates: z.boolean(),
  can_read_billing: z.boolean(),
  can_manage_billing: z.boolean(),
});

const limitsSchema = z
  .object({
    max_members: limitSchema,
    max_reports: limitSchema,
    drafts_per_month: limitSchema,
    drafts_total: limitSchema,
    custom_templates: z.boolean(),
  })
  .transform(
    (limits): PlanLimits => ({
      maxMembers: limits.max_members,
      maxReports: limits.max_reports,
      draftsPerMonth: limits.drafts_per_month,
      draftsTotal: limits.drafts_total,
      customTemplates: limits.custom_templates,
    }),
  );

const lineFields = {
  state: stateSchema,
  plan: planSchema,
  source: sourceSchema,
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  grace_ends_at: z.string().nullable(),
  limits: limitsSchema,
};

function toLine(line: {
  state: BillingState;
  plan: PlanCode | null;
  source: EntitlementSource | null;
  starts_at: string | null;
  ends_at: string | null;
  grace_ends_at: string | null;
  limits: PlanLimits;
}): BillingLine {
  return {
    state: line.state,
    plan: line.plan,
    source: line.source,
    startsAt: line.starts_at,
    endsAt: line.ends_at,
    graceEndsAt: line.grace_ends_at,
    limits: line.limits,
  };
}

const overviewSchema = z
  .object({
    organization_id: z.string(),
    enforced: z.boolean(),
    can_manage: z.boolean(),
    subscription: z.object({
      ...lineFields,
      usage: z.object({
        members: countSchema,
        invitations: countSchema,
        active_reports: countSchema,
        workspaces: countSchema,
      }),
    }),
    passes: z.array(
      z.object({
        ...lineFields,
        workspace_id: z.string(),
        usage: z.object({ members: countSchema, invitations: countSchema, reports: countSchema }),
      }),
    ),
    packs: z.array(z.object({ id: z.string(), drafts: countSchema, expires_at: z.string() })),
  })
  .transform(
    (overview): BillingOverview => ({
      organizationId: overview.organization_id,
      enforced: overview.enforced,
      canManage: overview.can_manage,
      subscription: {
        ...toLine(overview.subscription),
        usage: {
          members: overview.subscription.usage.members,
          invitations: overview.subscription.usage.invitations,
          activeReports: overview.subscription.usage.active_reports,
          workspaces: overview.subscription.usage.workspaces,
        },
      },
      passes: overview.passes.map((pass) => ({
        ...toLine(pass),
        workspaceId: pass.workspace_id,
        usage: pass.usage,
      })),
      packs: overview.packs.map((pack) => ({ id: pack.id, drafts: pack.drafts, expiresAt: pack.expires_at })),
    }),
  );

/**
 * Billing state of a workspace for the signed-in user. Null when they are
 * not a member (nor a billing reader of its organization), or on error.
 */
export async function getWorkspaceBillingState(workspaceId: string): Promise<WorkspaceBillingState | null> {
  if (!uuidSchema.safeParse(workspaceId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("workspace_billing_state", { p_workspace_id: workspaceId.toLowerCase() })
    .maybeSingle();
  if (error) {
    log.error("billing: could not read the workspace state", { workspaceId, error: error.message });
    return null;
  }
  if (!data) return null;
  const row = workspaceRowSchema.safeParse(data);
  if (!row.success) {
    log.error("billing: unexpected workspace state", { workspaceId });
    return null;
  }
  return {
    organizationId: row.data.organization_id,
    billingMode: row.data.billing_mode,
    state: row.data.state,
    plan: row.data.plan,
    source: row.data.source,
    endsAt: row.data.ends_at,
    graceEndsAt: row.data.grace_ends_at,
    limits: {
      maxMembers: row.data.max_members,
      maxReports: row.data.max_reports,
      draftsPerMonth: row.data.drafts_per_month,
      draftsTotal: row.data.drafts_total,
      customTemplates: row.data.custom_templates,
    },
    canReadBilling: row.data.can_read_billing,
    canManageBilling: row.data.can_manage_billing,
  };
}

/**
 * Whether the signed-in user's writes to a workspace pass the read-only rule
 * (KRB-178). For server code that writes with the service role on a user's
 * behalf, which the database guards do not check. False when the state
 * cannot be read: such a write waits rather than slips through.
 */
export async function workspaceIsWritable(workspaceId: string): Promise<boolean> {
  const state = await getWorkspaceBillingState(workspaceId);
  return state !== null && state.state !== "read_only";
}

/**
 * Billing overview of an organization for the signed-in user. Null when they
 * cannot read its billing, or on error.
 */
export async function getBillingOverview(organizationId: string): Promise<BillingOverview | null> {
  if (!uuidSchema.safeParse(organizationId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_overview", {
    p_organization_id: organizationId.toLowerCase(),
  });
  if (error) {
    log.error("billing: could not read the overview", { organizationId, error: error.message });
    return null;
  }
  if (data === null) return null;
  const overview = overviewSchema.safeParse(data);
  if (!overview.success) {
    log.error("billing: unexpected overview", { organizationId });
    return null;
  }
  return overview.data;
}
