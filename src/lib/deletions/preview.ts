import "server-only";
import { z } from "zod";
import { PLAN_CODES } from "@/lib/billing/catalog";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/workspaces/schemas";
import type { BillingTimeLeft } from "./losses";

// Typed wrappers of the previews of the deletions migration (KRB-180):
// report_deletion_preview, workspace_deletion_preview and
// organization_deletion_preview. They run with the signed-in user's rights
// and answer null to anyone who may not delete the thing, so callers answer
// with notFound() or hide the action. Ids and counts, plus the names the
// dialog shows.

const countSchema = z.number().int().nonnegative();

const billingTimeLeftSchema = z
  .object({
    subscription: z.array(
      z.object({
        entitlement_id: z.string(),
        plan: z.enum(PLAN_CODES),
        starts_at: z.string(),
        ends_at: z.string(),
      }),
    ),
    passes: z.array(
      z.object({
        entitlement_id: z.string(),
        workspace_id: z.string(),
        starts_at: z.string(),
        ends_at: z.string(),
      }),
    ),
    packs: z.array(z.object({ pack_id: z.string(), drafts_left: countSchema, expires_at: z.string() })),
  })
  .transform((left): BillingTimeLeft => ({
    subscription: left.subscription.map((period) => ({
      entitlementId: period.entitlement_id,
      plan: period.plan,
      startsAt: period.starts_at,
      endsAt: period.ends_at,
    })),
    passes: left.passes.map((pass) => ({
      entitlementId: pass.entitlement_id,
      workspaceId: pass.workspace_id,
      startsAt: pass.starts_at,
      endsAt: pass.ends_at,
    })),
    packs: left.packs.map((pack) => ({
      packId: pack.pack_id,
      draftsLeft: pack.drafts_left,
      expiresAt: pack.expires_at,
    })),
  }));

const reportPreviewSchema = z
  .object({
    report_id: z.string(),
    workspace_id: z.string(),
    title: z.string(),
    status: z.enum(["draft", "in_review", "final"]),
    sections: countSchema,
    files: countSchema,
    exports: countSchema,
  })
  .transform((preview) => ({
    reportId: preview.report_id,
    workspaceId: preview.workspace_id,
    title: preview.title,
    status: preview.status,
    sections: preview.sections,
    files: preview.files,
    exports: preview.exports,
  }));

export type ReportDeletionPreview = z.output<typeof reportPreviewSchema>;

const workspacePreviewSchema = z
  .object({
    workspace_id: z.string(),
    name: z.string(),
    organization_id: z.string(),
    organization_name: z.string(),
    billing_mode: z.enum(["subscription", "mission"]),
    passes: billingTimeLeftSchema.in.shape.passes,
    reports: countSchema,
    final_reports: countSchema,
    sections: countSchema,
    files: countSchema,
    exports: countSchema,
    members: countSchema,
    invitations: countSchema,
    templates: countSchema,
    // Pass purchases pending or in review: the deletion waits for them (KR071).
    payments_in_progress: countSchema,
  })
  .transform((preview) => ({
    workspaceId: preview.workspace_id,
    name: preview.name,
    organizationId: preview.organization_id,
    organizationName: preview.organization_name,
    billingMode: preview.billing_mode,
    passes: preview.passes.map((pass) => ({
      entitlementId: pass.entitlement_id,
      workspaceId: pass.workspace_id,
      startsAt: pass.starts_at,
      endsAt: pass.ends_at,
    })),
    reports: preview.reports,
    finalReports: preview.final_reports,
    sections: preview.sections,
    files: preview.files,
    exports: preview.exports,
    members: preview.members,
    invitations: preview.invitations,
    templates: preview.templates,
    paymentsInProgress: preview.payments_in_progress,
  }));

export type WorkspaceDeletionPreview = z.output<typeof workspacePreviewSchema>;

const organizationPreviewSchema = z
  .object({
    organization_id: z.string(),
    name: z.string(),
    workspaces: z.array(
      z.object({
        workspace_id: z.string(),
        name: z.string(),
        billing_mode: z.enum(["subscription", "mission"]),
        reports: countSchema,
        members: countSchema,
      }),
    ),
    billing: billingTimeLeftSchema,
    reports: countSchema,
    files: countSchema,
    members: countSchema,
    // Receipts that stay for the accounts, read by nobody signed in afterwards.
    receipts: countSchema,
    // Purchases pending or in review: the deletion waits for them (KR071).
    payments_in_progress: countSchema,
  })
  .transform((preview) => ({
    organizationId: preview.organization_id,
    name: preview.name,
    workspaces: preview.workspaces.map((workspace) => ({
      id: workspace.workspace_id,
      name: workspace.name,
      billingMode: workspace.billing_mode,
      reports: workspace.reports,
      members: workspace.members,
    })),
    billing: preview.billing,
    reports: preview.reports,
    files: preview.files,
    members: preview.members,
    receipts: preview.receipts,
    paymentsInProgress: preview.payments_in_progress,
  }));

export type OrganizationDeletionPreview = z.output<typeof organizationPreviewSchema>;

type Client = Awaited<ReturnType<typeof createClient>>;
type RpcResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function readPreview<T>(
  fn: string,
  call: (supabase: Client) => RpcResult,
  schema: z.ZodType<T, unknown>,
): Promise<T | null> {
  const { data, error } = await call(await createClient());
  if (error) {
    log.error("deletions: could not read a preview", { fn, error: error.message });
    return null;
  }
  if (data === null) return null;
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    log.error("deletions: unexpected preview", { fn });
    return null;
  }
  return parsed.data;
}

const sectionPreviewSchema = z
  .object({
    section_id: z.string(),
    workspace_id: z.string(),
    report_id: z.string(),
    parent_id: z.string().nullable(),
    title: z.string(),
    report_status: z.enum(["draft", "in_review", "final"]),
    subsections: countSchema,
    files: countSchema,
    with_text: countSchema,
  })
  .transform((preview) => ({
    sectionId: preview.section_id,
    workspaceId: preview.workspace_id,
    reportId: preview.report_id,
    parentId: preview.parent_id,
    title: preview.title,
    reportStatus: preview.report_status,
    subsections: preview.subsections,
    files: preview.files,
    withText: preview.with_text,
  }));

export type SectionDeletionPreview = z.output<typeof sectionPreviewSchema>;

/**
 * What deleting a section takes with its subsections (KRB-195), for the
 * owners and admins of its workspace. Null for anyone else, or on error.
 */
export async function getSectionDeletionPreview(sectionId: string): Promise<SectionDeletionPreview | null> {
  if (!uuidSchema.safeParse(sectionId).success) return null;
  return readPreview(
    "section_deletion_preview",
    (supabase) => supabase.rpc("section_deletion_preview", { p_section_id: sectionId.toLowerCase() }),
    sectionPreviewSchema,
  );
}

/** What deleting the report takes, for its owners and admins. Null for anyone else, or on error. */
export async function getReportDeletionPreview(reportId: string): Promise<ReportDeletionPreview | null> {
  if (!uuidSchema.safeParse(reportId).success) return null;
  return readPreview(
    "report_deletion_preview",
    (supabase) => supabase.rpc("report_deletion_preview", { p_report_id: reportId.toLowerCase() }),
    reportPreviewSchema,
  );
}

/** What deleting the workspace takes, for its owners. Null for anyone else, or on error. */
export async function getWorkspaceDeletionPreview(
  workspaceId: string,
): Promise<WorkspaceDeletionPreview | null> {
  if (!uuidSchema.safeParse(workspaceId).success) return null;
  return readPreview(
    "workspace_deletion_preview",
    (supabase) => supabase.rpc("workspace_deletion_preview", { p_workspace_id: workspaceId.toLowerCase() }),
    workspacePreviewSchema,
  );
}

/** What deleting the organization takes, for its owner. Null for anyone else, or on error. */
export async function getOrganizationDeletionPreview(
  organizationId: string,
): Promise<OrganizationDeletionPreview | null> {
  if (!uuidSchema.safeParse(organizationId).success) return null;
  return readPreview(
    "organization_deletion_preview",
    (supabase) =>
      supabase.rpc("organization_deletion_preview", { p_organization_id: organizationId.toLowerCase() }),
    organizationPreviewSchema,
  );
}
