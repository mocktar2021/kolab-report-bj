import { createTranslator } from "next-intl";
import { PLANS, type PlanCode } from "@/lib/billing/catalog";
import { BILLING_TIME_ZONE, calendarDaysUntil, formatBillingDate } from "@/lib/billing/dates";
import type { BillingNoticeKind } from "@/lib/billing/notice-kinds";
import messages from "../../../messages/fr.json";
import { escapeHtml } from "./invitation-email";
import type { Email } from "./send";

// The renewal reminders of KRB-178 (ADR 001, sections 1 and 17, Q14): 7 days
// before the end, the day before, once the period has ended, and once the
// workspace is read-only. The copy is under Billing.email in
// messages/fr.json.

const MESSAGE_KEYS = { d7: "d7", d1: "d1", ended: "ended", read_only: "readOnly" } as const;

export type BillingReminderInput = {
  to: string;
  kind: BillingNoticeKind;
  plan: PlanCode;
  organizationName: string;
  /** The workspace of a Pass Mission, null for the organization's subscription. */
  workspaceName: string | null;
  endsAt: string;
  /** When the workspace turns read-only, or turned read-only. */
  graceEndsAt: string;
  /** The organization's billing page. */
  link: string;
  /** For the days left in the subject. */
  now?: Date;
};

const t = createTranslator({
  locale: "fr",
  messages,
  namespace: "Billing.email",
  timeZone: BILLING_TIME_ZONE,
});

/** French reminder e-mail with a link to renew, styled like the other e-mails of the app. */
export function billingReminderEmail(input: BillingReminderInput): Email {
  const key = MESSAGE_KEYS[input.kind];
  const date = formatBillingDate(input.kind === "read_only" ? input.graceEndsAt : input.endsAt);
  const graceEnd = formatBillingDate(input.graceEndsAt);
  const days = Math.max(0, calendarDaysUntil(input.endsAt, input.now));
  const line =
    input.workspaceName === null
      ? t("line.subscription", { plan: PLANS[input.plan].label, organization: input.organizationName })
      : t("line.mission", { workspace: input.workspaceName, organization: input.organizationName });

  const subject = t(`${key}.subject`, { days });
  const heading = t(`${key}.heading`, { date });
  const body = t(`${key}.body`, { line, date, graceEnd });
  const button = t("button");
  const outro = t("outro", { organization: input.organizationName });

  const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#FAFAFA;font-family:Arial,Helvetica,sans-serif;color:#09090B;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAFA;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:16px;padding:32px;">
            <tr><td style="font-size:15px;font-weight:bold;padding-bottom:24px;">KolabReport</td></tr>
            <tr><td style="font-size:22px;font-weight:bold;line-height:1.3;padding-bottom:12px;">${escapeHtml(heading)}</td></tr>
            <tr><td style="font-size:15px;line-height:1.6;color:#3F3F46;padding-bottom:24px;">${escapeHtml(body)}</td></tr>
            <tr>
              <td style="padding-bottom:24px;">
                <a href="${escapeHtml(input.link)}" style="display:inline-block;background:#09090B;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 24px;border-radius:999px;">${escapeHtml(button)}</a>
              </td>
            </tr>
            <tr><td style="font-size:13px;line-height:1.6;color:#5F5F68;">${escapeHtml(outro)}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${body}\n\n${t("linkLabel")} : ${input.link}\n\n${outro}\n`;

  return { to: input.to, subject, html, text };
}
