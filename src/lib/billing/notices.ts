import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { billingReminderEmail } from "@/lib/email/billing-reminder-email";
import { sendEmail, type Email } from "@/lib/email/send";
import { publicEnv } from "@/lib/env";
import { log } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";
import { PLAN_CODES, type PlanCode } from "./catalog";
import { BILLING_NOTICE_KINDS, type BillingNoticeKind } from "./notice-kinds";

// Renewal reminders (KRB-178). public.billing_due_notices claims the notices
// due now, once ever per entitlement and kind, and writes their in-app
// notifications in the same transaction. This module e-mails the people it
// returns (the organization owner and the owners of the workspaces the line
// covers), then records how many e-mails went out with
// public.billing_finish_notice. A notice is claimed before its e-mails, so
// it never goes out twice; an e-mail that fails is not sent again by the
// next run (docs/operations/billing.md says how to send it by hand).
//
// `admin` is the service-role client. Nothing here reads a tenant table
// directly: both calls are functions granted to the service role only.

export type BillingNoticeRecipient = { userId: string; email: string; name: string };

export type DueNotice = {
  entitlementId: string;
  kind: BillingNoticeKind;
  organizationId: string;
  organizationName: string;
  /** The workspace of a Pass Mission, null for the subscription. */
  workspaceId: string | null;
  workspaceName: string | null;
  plan: PlanCode;
  endsAt: string;
  graceEndsAt: string;
  recipients: BillingNoticeRecipient[];
};

/** What the cron answers for this step: counts only, never a name or an address. */
export type BillingNoticesSummary = {
  /** Notices claimed by this run. */
  notices: number;
  emailsSent: number;
  emailsFailed: number;
  /** False when a database call failed, a row was unreadable or an e-mail failed. */
  ok: boolean;
};

export type SendBillingNoticesOptions = {
  /** Base URL of the renew links. */
  appUrl?: string;
  send?: (email: Email) => Promise<boolean>;
  now?: () => Date;
};

const rowSchema = z.object({
  entitlement_id: z.string(),
  kind: z.enum(BILLING_NOTICE_KINDS),
  organization_id: z.string(),
  organization_name: z.string(),
  workspace_id: z.string().nullable(),
  workspace_name: z.string().nullable(),
  plan: z.enum(PLAN_CODES),
  ends_at: z.string(),
  grace_ends_at: z.string(),
  recipients: z.array(z.object({ user_id: z.string(), email: z.string(), name: z.string() })),
});

function toNotice(row: z.infer<typeof rowSchema>): DueNotice {
  return {
    entitlementId: row.entitlement_id,
    kind: row.kind,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_id ? row.workspace_name : null,
    plan: row.plan,
    endsAt: row.ends_at,
    graceEndsAt: row.grace_ends_at,
    recipients: row.recipients.map((r) => ({ userId: r.user_id, email: r.email, name: r.name })),
  };
}

/** The billing page of an organization, where owners renew (KRB-176, KRB-177). */
export function renewLink(appUrl: string, organizationId: string): string {
  return `${appUrl.replace(/\/+$/, "")}/fr/organisations/${organizationId}/abonnement`;
}

/** The reminder e-mails of one notice, one per recipient. */
export function noticeEmails(notice: DueNotice, appUrl: string, now: Date): Email[] {
  const link = renewLink(appUrl, notice.organizationId);
  return notice.recipients.map((recipient) =>
    billingReminderEmail({
      to: recipient.email,
      kind: notice.kind,
      plan: notice.plan,
      organizationName: notice.organizationName,
      // A pass whose workspace has no name left still says it is a pass.
      workspaceName: notice.workspaceId ? (notice.workspaceName ?? "") : null,
      endsAt: notice.endsAt,
      graceEndsAt: notice.graceEndsAt,
      link,
      now,
    }),
  );
}

/** Claims the notices due now, e-mails them and records the result. Never throws. */
export async function sendBillingNotices(
  admin: SupabaseClient<Database>,
  options: SendBillingNoticesOptions = {},
): Promise<BillingNoticesSummary> {
  const { appUrl = publicEnv.NEXT_PUBLIC_APP_URL, send = sendEmail, now = () => new Date() } = options;
  const summary: BillingNoticesSummary = { notices: 0, emailsSent: 0, emailsFailed: 0, ok: true };

  const { data, error } = await admin.rpc("billing_due_notices");
  if (error || !data) {
    log.error("billing: could not claim the reminders", { error: error?.message });
    return { ...summary, ok: false };
  }

  for (const raw of data) {
    summary.notices += 1;
    const row = rowSchema.safeParse(raw);
    if (!row.success) {
      // Claimed but unreadable: nothing can be sent. The runbook says how to
      // find it in private.billing_notices (emailed_at stays null).
      log.error("billing: unexpected reminder", {
        entitlementId: (raw as { entitlement_id?: unknown }).entitlement_id,
      });
      summary.ok = false;
      continue;
    }
    const notice = toNotice(row.data);

    let sent = 0;
    let failed = 0;
    if (notice.recipients.length === 0) {
      log.warn("billing: reminder skipped", {
        entitlementId: notice.entitlementId,
        kind: notice.kind,
        reason: "no recipient",
      });
    } else {
      const results = await Promise.allSettled(
        noticeEmails(notice, appUrl, now()).map((email) => send(email)),
      );
      sent = results.filter((result) => result.status === "fulfilled" && result.value).length;
      failed = results.length - sent;
      if (failed > 0) {
        log.warn("billing: reminder skipped", {
          entitlementId: notice.entitlementId,
          kind: notice.kind,
          reason: "e-mail failed",
          failed,
          sent,
        });
        summary.ok = false;
      } else {
        log.info("billing: reminder sent", {
          entitlementId: notice.entitlementId,
          organizationId: notice.organizationId,
          kind: notice.kind,
          recipients: sent,
        });
      }
    }
    summary.emailsSent += sent;
    summary.emailsFailed += failed;

    const { error: finishError } = await admin.rpc("billing_finish_notice", {
      p_entitlement_id: notice.entitlementId,
      p_kind: notice.kind,
      p_sent: sent,
      p_failed: failed,
    });
    if (finishError) {
      log.error("billing: could not record a reminder", {
        entitlementId: notice.entitlementId,
        kind: notice.kind,
        error: finishError.message,
      });
      summary.ok = false;
    }
  }

  return summary;
}
