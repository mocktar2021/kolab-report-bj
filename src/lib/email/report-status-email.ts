import type { ReportAction } from "@/lib/reports/status";
import { escapeHtml } from "./invitation-email";
import type { Email } from "./send";

export type ReportStatusEmailInput = {
  to: string;
  action: ReportAction;
  reportTitle: string;
  workspaceName: string;
  actorName: string;
  link: string;
};

const COPY: Record<ReportAction, { subject: string; heading: string; intro: string }> = {
  submit: {
    subject: "« {title} » est en revue",
    heading: "Le rapport est en revue",
    intro: "{actor} a soumis le rapport « {title} » pour revue.",
  },
  sendBack: {
    subject: "« {title} » repasse en brouillon",
    heading: "Le rapport repasse en brouillon",
    intro: "{actor} a repassé le rapport « {title} » en brouillon pour des modifications.",
  },
  finalize: {
    subject: "« {title} » est final",
    heading: "Le rapport est final",
    intro: "{actor} a finalisé le rapport « {title} ». Ses sections sont maintenant en lecture seule.",
  },
  reopen: {
    subject: "« {title} » est rouvert",
    heading: "Le rapport est rouvert",
    intro: "{actor} a rouvert le rapport « {title} ». Ses sections peuvent de nouveau être modifiées.",
  },
};

function fill(template: string, input: ReportStatusEmailInput) {
  return template.replaceAll("{title}", input.reportTitle).replaceAll("{actor}", input.actorName);
}

/** French e-mail about a report's status change (KRB-20), styled like the invitation e-mail. */
export function reportStatusEmail(input: ReportStatusEmailInput): Email {
  const copy = COPY[input.action];
  const subject = fill(copy.subject, input);
  const intro = fill(copy.intro, input);
  const outro = `Vous recevez cet e-mail car vous participez à ce rapport dans l'espace de travail ${input.workspaceName}.`;

  const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#FAFAFA;font-family:Arial,Helvetica,sans-serif;color:#09090B;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAFA;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:16px;padding:32px;">
            <tr><td style="font-size:15px;font-weight:bold;padding-bottom:24px;">KolabReport</td></tr>
            <tr><td style="font-size:22px;font-weight:bold;line-height:1.3;padding-bottom:12px;">${escapeHtml(copy.heading)}</td></tr>
            <tr><td style="font-size:15px;line-height:1.6;color:#3F3F46;padding-bottom:24px;">${escapeHtml(intro)}</td></tr>
            <tr>
              <td style="padding-bottom:24px;">
                <a href="${escapeHtml(input.link)}" style="display:inline-block;background:#09090B;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 24px;border-radius:999px;">Voir le rapport</a>
              </td>
            </tr>
            <tr><td style="font-size:13px;line-height:1.6;color:#5F5F68;">${escapeHtml(outro)}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${intro}\n\nVoir le rapport : ${input.link}\n\n${outro}\n`;

  return { to: input.to, subject, html, text };
}
