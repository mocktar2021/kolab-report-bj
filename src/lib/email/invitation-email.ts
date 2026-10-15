import type { Email } from "./send";

const ROLE_LABELS = {
  owner: "propriétaire",
  admin: "administrateur",
  expert: "expert",
  viewer: "lecteur",
} as const;

export type InvitationEmailInput = {
  to: string;
  link: string;
  workspaceName: string;
  organizationName: string | null;
  /** Null when nobody can be named, for example when the sender's account is gone: the e-mail names the workspace only. */
  inviterName: string | null;
  role: keyof typeof ROLE_LABELS;
  expiresAt: Date;
};

/** Names come from users, so they are escaped before going into the HTML. */
export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** French invitation e-mail, styled like the auth e-mails in supabase/templates. */
export function invitationEmail(input: InvitationEmailInput): Email {
  const role = ROLE_LABELS[input.role];
  const expires = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(
    input.expiresAt,
  );
  const workspace = input.organizationName
    ? `${input.workspaceName} (${input.organizationName})`
    : input.workspaceName;
  const subject = input.inviterName
    ? `${input.inviterName} vous invite sur KolabReport`
    : `Invitation à rejoindre ${input.workspaceName} sur KolabReport`;
  const intro = input.inviterName
    ? `${input.inviterName} vous invite à rejoindre l'espace de travail ${workspace} en tant que ${role}.`
    : `Vous êtes invité à rejoindre l'espace de travail ${workspace} en tant que ${role}.`;
  const outro = `Le lien reste valable jusqu'au ${expires}. Si vous n'attendiez pas cette invitation, ignorez cet e-mail.`;

  const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#FAFAFA;font-family:Arial,Helvetica,sans-serif;color:#09090B;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAFA;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:16px;padding:32px;">
            <tr><td style="font-size:15px;font-weight:bold;padding-bottom:24px;">KolabReport</td></tr>
            <tr><td style="font-size:22px;font-weight:bold;line-height:1.3;padding-bottom:12px;">Vous êtes invité sur KolabReport</td></tr>
            <tr><td style="font-size:15px;line-height:1.6;color:#3F3F46;padding-bottom:24px;">${escapeHtml(intro)}</td></tr>
            <tr>
              <td style="padding-bottom:24px;">
                <a href="${escapeHtml(input.link)}" style="display:inline-block;background:#09090B;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 24px;border-radius:999px;">Voir l'invitation</a>
              </td>
            </tr>
            <tr><td style="font-size:13px;line-height:1.6;color:#5F5F68;">${escapeHtml(outro)}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${intro}\n\nVoir l'invitation : ${input.link}\n\n${outro}\n`;

  return { to: input.to, subject, html, text };
}
