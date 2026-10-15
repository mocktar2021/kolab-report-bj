import "server-only";
import { z } from "zod";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { PLAN_CODES, type PlanCode, type PlanLimits } from "./catalog";

// Typed wrappers of public.workspace_billing_state, public.billing_overview
// and public.workspace_billing_usage. All three run with the signed-in
// user's rights: members read the state of their workspace, billing readers
// (organization owner, owners and admins of its workspaces) read the
// overview of their organization, with its purchases and receipts, and
// members who write read the AI drafts left in their workspace. No name or
// e-mail of a person.
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

/** AI drafts of a billing line, counted like the reservation of start_ai_generation. */
export type DraftUsage = {
  /** This month (UTC) for a monthly allowance, since the start for the trial and a pass. */
  used: number;
  /** Null when there is no limit. */
  allowance: number | null;
  period: "month" | "total";
};

export const PURCHASE_STATUSES = ["pending", "paid", "expired", "refunded", "review"] as const;

export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export type PurchaseSummary = {
  id: string;
  offer: string;
  /** French label frozen at checkout. */
  offerLabel: string;
  quantity: number;
  /** The workspace of a Pass Mission. */
  workspaceId: string | null;
  workspaceName: string | null;
  amountXof: number;
  status: PurchaseStatus;
  /** FedaPay's last status: declined or canceled on a pending purchase means it did not go through. */
  fedapayStatus: string | null;
  createdAt: string;
  paidAt: string | null;
  receiptId: string | null;
  receiptNumber: string | null;
};

export type ReceiptSummary = {
  id: string;
  number: string;
  kind: "receipt" | "credit_note";
  issuedAt: string;
  totalXof: number;
  /** sandbox and mock receipts are test receipts. */
  environment: "sandbox" | "live" | "mock" | "manual";
  /** Label of the first line. */
  label: string | null;
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
    /** Null when the database answers without it (before KRB-177). */
    drafts: DraftUsage | null;
  };
  /** One per mission workspace, oldest first. */
  passes: (BillingLine & {
    workspaceId: string;
    workspaceName: string | null;
    usage: { members: number; invitations: number; reports: number };
    drafts: DraftUsage | null;
  })[];
  /** Running packs, the one that expires first first. */
  packs: { id: string; drafts: number; used: number; expiresAt: string }[];
  /** The last 50 purchases, newest first. */
  purchases: PurchaseSummary[];
  purchasesTotal: number;
  /** The last 100 receipts, newest first. */
  receipts: ReceiptSummary[];
  receiptsTotal: number;
  /**
   * Workspaces a pass can be bought for, by name: all of them for the
   * organization owner, the ones the user belongs to for the others. A pass
   * or a purchase of another workspace comes with a null workspaceName.
   */
  workspaces: { id: string; name: string }[];
};

/** What the hints of the members page, the report dialog and the draft panel need. */
export type WorkspaceUsage = {
  billingMode: BillingMode;
  enforced: boolean;
  state: BillingState;
  plan: PlanCode | null;
  /** Null unless the user reads the organization's billing. */
  members: number | null;
  invitations: number | null;
  maxMembers: number | null;
  reports: number | null;
  maxReports: number | null;
  drafts: DraftUsage;
  /** Drafts left in the organization's running packs. */
  packDraftsLeft: number;
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

const draftsSchema = z
  .object({
    used: countSchema,
    allowance: limitSchema,
    period: z.enum(["month", "total"]),
  })
  .optional()
  .transform((drafts): DraftUsage | null => drafts ?? null);

const purchaseSchema = z
  .object({
    id: z.string(),
    offer: z.string(),
    offer_label: z.string(),
    quantity: countSchema,
    workspace_id: z.string().nullable(),
    workspace_name: z.string().nullable(),
    amount_xof: countSchema,
    status: z.enum(PURCHASE_STATUSES),
    fedapay_status: z.string().nullable(),
    created_at: z.string(),
    paid_at: z.string().nullable(),
    receipt_id: z.string().nullable(),
    receipt_number: z.string().nullable(),
  })
  .transform(
    (purchase): PurchaseSummary => ({
      id: purchase.id,
      offer: purchase.offer,
      offerLabel: purchase.offer_label,
      quantity: purchase.quantity,
      workspaceId: purchase.workspace_id,
      workspaceName: purchase.workspace_name,
      amountXof: purchase.amount_xof,
      status: purchase.status,
      fedapayStatus: purchase.fedapay_status,
      createdAt: purchase.created_at,
      paidAt: purchase.paid_at,
      receiptId: purchase.receipt_id,
      receiptNumber: purchase.receipt_number,
    }),
  );

const receiptSchema = z
  .object({
    id: z.string(),
    number: z.string(),
    kind: z.enum(["receipt", "credit_note"]),
    issued_at: z.string(),
    total_xof: countSchema,
    environment: z.enum(["sandbox", "live", "mock", "manual"]),
    label: z.string().nullable(),
  })
  .transform(
    (receipt): ReceiptSummary => ({
      id: receipt.id,
      number: receipt.number,
      kind: receipt.kind,
      issuedAt: receipt.issued_at,
      totalXof: receipt.total_xof,
      environment: receipt.environment,
      label: receipt.label,
    }),
  );

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
      drafts: draftsSchema,
    }),
    passes: z.array(
      z.object({
        ...lineFields,
        workspace_id: z.string(),
        workspace_name: z.string().nullable().optional(),
        usage: z.object({ members: countSchema, invitations: countSchema, reports: countSchema }),
        drafts: draftsSchema,
      }),
    ),
    packs: z.array(
      z.object({ id: z.string(), drafts: countSchema, used: countSchema.default(0), expires_at: z.string() }),
    ),
    purchases: z.array(purchaseSchema).default([]),
    purchases_total: countSchema.default(0),
    receipts: z.array(receiptSchema).default([]),
    receipts_total: countSchema.default(0),
    workspaces: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
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
        drafts: overview.subscription.drafts,
      },
      passes: overview.passes.map((pass) => ({
        ...toLine(pass),
        workspaceId: pass.workspace_id,
        workspaceName: pass.workspace_name ?? null,
        usage: pass.usage,
        drafts: pass.drafts,
      })),
      packs: overview.packs.map((pack) => ({
        id: pack.id,
        drafts: pack.drafts,
        used: pack.used,
        expiresAt: pack.expires_at,
      })),
      purchases: overview.purchases,
      purchasesTotal: overview.purchases_total,
      receipts: overview.receipts,
      receiptsTotal: overview.receipts_total,
      workspaces: overview.workspaces,
    }),
  );

const usageRowSchema = z.object({
  billing_mode: z.enum(["subscription", "mission"]),
  enforced: z.boolean(),
  state: stateSchema,
  plan: planSchema,
  members: limitSchema,
  invitations: limitSchema,
  max_members: limitSchema,
  reports: limitSchema,
  max_reports: limitSchema,
  drafts_used: countSchema,
  drafts_allowance: limitSchema,
  drafts_period: z.enum(["month", "total"]),
  pack_drafts_left: countSchema,
});

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

/**
 * Usage of the billing line that covers a workspace, for the hints where
 * limits bite. Null for viewers and people outside the workspace, or on
 * error. Member and report counts are null unless the user reads the
 * organization's billing.
 */
export async function getWorkspaceUsage(workspaceId: string): Promise<WorkspaceUsage | null> {
  if (!uuidSchema.safeParse(workspaceId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("workspace_billing_usage", { p_workspace_id: workspaceId.toLowerCase() })
    .maybeSingle();
  if (error) {
    log.error("billing: could not read the workspace usage", { workspaceId, error: error.message });
    return null;
  }
  if (!data) return null;
  const row = usageRowSchema.safeParse(data);
  if (!row.success) {
    log.error("billing: unexpected workspace usage", { workspaceId });
    return null;
  }
  return {
    billingMode: row.data.billing_mode,
    enforced: row.data.enforced,
    state: row.data.state,
    plan: row.data.plan,
    members: row.data.members,
    invitations: row.data.invitations,
    maxMembers: row.data.max_members,
    reports: row.data.reports,
    maxReports: row.data.max_reports,
    drafts: {
      used: row.data.drafts_used,
      allowance: row.data.drafts_allowance,
      period: row.data.drafts_period,
    },
    packDraftsLeft: row.data.pack_drafts_left,
  };
}
