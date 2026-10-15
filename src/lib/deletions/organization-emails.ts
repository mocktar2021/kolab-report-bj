import "server-only";
import { organizationDeletedEmail } from "@/lib/email/organization-deleted-email";
import { sendEmail } from "@/lib/email/send";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { organizationDeletionRecipients, type DeletionRecipient } from "./recipients";

// The e-mail sent when an organization is deleted (KRB-180). The rows it
// needs go with the organization, so they are read just before the
// deletion, and the e-mails go after the response, once it is committed.

export type OrganizationDeletionNotice = {
  organizationName: string;
  /** profiles.full_name of the person deleting, null when empty. */
  actorName: string | null;
  recipients: DeletionRecipient[];
};

/**
 * Reads who to tell before the deletion. The organization owner cannot read
 * the members of the workspaces they are not in (RLS), so this uses the
 * service role, scoped to the workspaces of `organizationId`. Null when a
 * read fails: the deletion goes on, without e-mails.
 */
export async function readOrganizationDeletionNotice(
  organizationId: string,
  actorId: string,
): Promise<OrganizationDeletionNotice | null> {
  try {
    const admin = createAdminClient();
    const [{ data: organization, error: organizationError }, { data: workspaces, error: workspacesError }] =
      await Promise.all([
        admin.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
        admin.from("workspaces").select("id, name").eq("organization_id", organizationId),
      ]);
    if (organizationError || workspacesError || !organization || !workspaces) {
      log.error("deletions: could not read who to tell", {
        organizationId,
        error: organizationError?.message ?? workspacesError?.message,
      });
      return null;
    }

    const workspaceIds = workspaces.map((workspace) => workspace.id);
    const { data: managers, error: managersError } =
      workspaceIds.length === 0
        ? { data: [], error: null }
        : await admin
            .from("workspace_members")
            .select("user_id, workspace_id, profile:profiles!workspace_members_user_id_fkey(email)")
            .in("workspace_id", workspaceIds)
            .in("role", ["owner", "admin"]);
    if (managersError || !managers) {
      log.error("deletions: could not read who to tell", { organizationId, error: managersError?.message });
      return null;
    }

    // The person deleting reads their own profile.
    const supabase = await createClient();
    const { data: actor } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", actorId)
      .maybeSingle();

    return {
      organizationName: organization.name,
      actorName: actor?.full_name?.trim() || null,
      recipients: organizationDeletionRecipients(
        managers.map((row) => ({
          user_id: row.user_id,
          workspace_id: row.workspace_id,
          email: row.profile?.email ?? null,
        })),
        new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
        actorId,
      ),
    };
  } catch (error) {
    log.error("deletions: could not read who to tell", {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Sends one e-mail to each owner and admin. Never throws: a failed send is
 * logged and the deletion stays. Counts only in the logs, never an address.
 */
export async function sendOrganizationDeletionEmails(
  notice: OrganizationDeletionNotice,
  deletedAt: Date,
): Promise<void> {
  const emails = notice.recipients.map((recipient) =>
    organizationDeletedEmail({
      to: recipient.email,
      organizationName: notice.organizationName,
      workspaceNames: recipient.workspaceNames,
      actorName: notice.actorName,
      deletedAt,
    }),
  );
  const results = await Promise.allSettled(emails.map((email) => sendEmail(email)));
  const failed = results.filter((result) => result.status === "rejected" || !result.value).length;
  if (failed > 0) log.warn("deletions: organization e-mails not sent", { failed, total: emails.length });
}
