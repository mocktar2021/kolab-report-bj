import { PUBLISHER } from "@/content/legal/publisher";
import { BILLING_TIME_ZONE } from "@/lib/billing/format";
import { escapeHtml } from "./invitation-email";
import type { Email } from "./send";

export type OrganizationDeletedEmailInput = {
  to: string;
  organizationName: string;
  /** The workspaces that went with it where the recipient was an owner or an admin. */
  workspaceNames: string[];
  /** profiles.full_name of the person who deleted it, null when they never gave one. Never an e-mail. */
  actorName: string | null;
  deletedAt: Date;
};

/** "15 octobre 2026 à 14:05", in Benin time like the rest of the app. */
const WHEN = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: BILLING_TIME_ZONE,
});

/**
 * French e-mail to the owners and admins of the workspaces of a deleted
 * organization (KRB-180): which organization and workspaces went, who
 * deleted them (name only) and when. Styled like the invitation e-mail. No
 * button: nothing is left to open.
 */
export function organizationDeletedEmail(input: OrganizationDeletedEmailInput): Email {
  const actor = input.actorName?.trim() || "Le propriétaire de l'organisation";
  const one = input.workspaceNames.length === 1;
  const subject = `L'organisation « ${input.organizationName} » a été supprimée`;
  const heading = "Une organisation a été supprimée";
  const intro = `${actor} a supprimé l'organisation « ${input.organizationName} » le ${WHEN.format(input.deletedAt)} (heure de Cotonou).`;
  const listTitle = one
    ? "Cet espace de travail a été supprimé avec elle :"
    : "Ces espaces de travail ont été supprimés avec elle :";
  const names = input.workspaceNames.map((name) => `« ${name} »`);
  const gone = one
    ? "Ses rapports, ses fichiers et ses exports sont supprimés aussi. La suppression est définitive."
    : "Leurs rapports, leurs fichiers et leurs exports sont supprimés aussi. La suppression est définitive.";
  const outro = `Vous recevez cet e-mail car vous étiez propriétaire ou administrateur de ${one ? "cet espace" : "ces espaces"} dans KolabReport. Pour toute question, écrivez à ${PUBLISHER.email}.`;

  const items = names.map((name) => `<li style="padding-bottom:4px;">${escapeHtml(name)}</li>`).join("");

  const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#FAFAFA;font-family:Arial,Helvetica,sans-serif;color:#09090B;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAFA;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:16px;padding:32px;">
            <tr><td style="font-size:15px;font-weight:bold;padding-bottom:24px;">KolabReport</td></tr>
            <tr><td style="font-size:22px;font-weight:bold;line-height:1.3;padding-bottom:12px;">${escapeHtml(heading)}</td></tr>
            <tr><td style="font-size:15px;line-height:1.6;color:#3F3F46;padding-bottom:16px;">${escapeHtml(intro)}</td></tr>
            <tr><td style="font-size:15px;line-height:1.6;color:#3F3F46;">${escapeHtml(listTitle)}</td></tr>
            <tr><td style="font-size:15px;line-height:1.6;color:#3F3F46;padding-bottom:16px;"><ul style="margin:8px 0 0;padding-left:20px;">${items}</ul></td></tr>
            <tr><td style="font-size:15px;line-height:1.6;color:#3F3F46;padding-bottom:24px;">${escapeHtml(gone)}</td></tr>
            <tr><td style="font-size:13px;line-height:1.6;color:#5F5F68;">${escapeHtml(outro)}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${intro}\n\n${listTitle}\n${names.map((name) => `- ${name}`).join("\n")}\n\n${gone}\n\n${outro}\n`;

  return { to: input.to, subject, html, text };
}
