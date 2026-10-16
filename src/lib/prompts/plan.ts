import "server-only";
import { getReadOnlyReason, readWorkspaceBillingState, type ReadOnlyReason } from "@/lib/billing/banner";
import type { PlanCode } from "@/lib/billing/catalog";

// Whether the organization's plan lets a workspace write its own templates
// (KRB-198), read from workspace_billing_state once per request. The pages
// say so before anyone fills the editor; private.billing_check_templates
// still has the final say on save (KR043, KR044).

export type TemplatePlan = {
  /** Set while the workspace is read-only: that notice comes first (templatesBlocked). */
  readOnly: ReadOnlyReason | null;
  /** False when the plan has no custom templates (Indépendant, Pass Mission). */
  customTemplates: boolean;
  plan: PlanCode | null;
  organizationId: string | null;
  /** Can buy another offer: the link goes to the billing page instead of the public offers. */
  canManageBilling: boolean;
};

/**
 * The plan rules for templates in a workspace. When the state can't be
 * read, nothing is blocked here and the database decides on save.
 */
export async function getTemplatePlan(workspaceId: string): Promise<TemplatePlan> {
  const [state, readOnly] = await Promise.all([
    readWorkspaceBillingState(workspaceId),
    getReadOnlyReason(workspaceId),
  ]);
  return {
    readOnly,
    customTemplates: state ? state.limits.customTemplates : true,
    plan: state?.plan ?? null,
    organizationId: state?.organizationId ?? null,
    canManageBilling: state?.canManageBilling ?? false,
  };
}

/** Writing a template is blocked: read-only first, then the plan. */
export function templatesBlocked(plan: TemplatePlan): "readOnly" | "templatesNotIncluded" | null {
  if (plan.readOnly) return "readOnly";
  if (!plan.customTemplates) return "templatesNotIncluded";
  return null;
}
