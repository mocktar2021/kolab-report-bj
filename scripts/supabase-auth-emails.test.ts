import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseEmailSections, smtpFields, templateFields, urlFields } from "./supabase-auth-emails.mjs";

const toml = `
[auth.email]
enable_confirmations = true

# French e-mail templates.
[auth.email.template.confirmation]
subject = "Confirmez votre adresse e-mail"
content_path = "./supabase/templates/confirmation.html"

[auth.email.notification.password_changed]
enabled = true
subject = "Votre mot de passe a été modifié"
content_path = "./supabase/templates/password_changed_notification.html"

[auth.sms]
template = "Your code is {{ .Code }}"
`;

describe("parseEmailSections", () => {
  it("reads the template and notification sections and nothing else", () => {
    expect(parseEmailSections(toml)).toEqual({
      template: {
        confirmation: {
          subject: "Confirmez votre adresse e-mail",
          content_path: "./supabase/templates/confirmation.html",
        },
      },
      notification: {
        password_changed: {
          enabled: true,
          subject: "Votre mot de passe a été modifié",
          content_path: "./supabase/templates/password_changed_notification.html",
        },
      },
    });
  });
});

describe("templateFields", () => {
  it("maps each section to the Management API fields", async () => {
    const fields = await templateFields(toml, async (file) => `<html>${file}</html>`);
    expect(fields).toEqual({
      mailer_subjects_confirmation: "Confirmez votre adresse e-mail",
      mailer_templates_confirmation_content: "<html>./supabase/templates/confirmation.html</html>",
      mailer_notifications_password_changed_enabled: true,
      mailer_subjects_password_changed_notification: "Votre mot de passe a été modifié",
      mailer_templates_password_changed_notification_content:
        "<html>./supabase/templates/password_changed_notification.html</html>",
    });
  });

  it("covers every template of the real config.toml, in French", async () => {
    const real = await readFile("supabase/config.toml", "utf8");
    const fields = await templateFields(real);
    for (const name of ["confirmation", "recovery", "invite", "magic_link", "email_change"]) {
      expect(fields[`mailer_subjects_${name}`]).toBeTruthy();
      expect(fields[`mailer_templates_${name}_content`]).toContain('lang="fr"');
    }
  });
});

describe("smtpFields", () => {
  it("is null until the password and the sender address are both set", () => {
    expect(smtpFields({})).toBeNull();
    expect(smtpFields({ SMTP_PASS: "x" })).toBeNull();
  });

  it("defaults to Resend and the KolabReport sender name", () => {
    expect(smtpFields({ SMTP_PASS: "re_x", SMTP_ADMIN_EMAIL: "noreply@email.kolab.test" })).toEqual({
      smtp_host: "smtp.resend.com",
      smtp_port: "465",
      smtp_user: "resend",
      smtp_pass: "re_x",
      smtp_admin_email: "noreply@email.kolab.test",
      smtp_sender_name: "KolabReport",
    });
  });
});

describe("urlFields", () => {
  it("is null without AUTH_SITE_URL", () => {
    expect(urlFields({})).toBeNull();
  });

  it("allows the site and the extra redirect URLs", () => {
    expect(
      urlFields({
        AUTH_SITE_URL: "https://kolab.test/",
        AUTH_REDIRECT_URLS: "https://*-team.vercel.app/**, https://other.test/**",
      }),
    ).toEqual({
      site_url: "https://kolab.test",
      uri_allow_list: "https://kolab.test/**,https://*-team.vercel.app/**,https://other.test/**",
    });
  });

  it("refuses a site URL that is not an https origin", () => {
    expect(() => urlFields({ AUTH_SITE_URL: "http://localhost:3000" })).toThrow();
    expect(() => urlFields({ AUTH_SITE_URL: "https://kolab.test/fr" })).toThrow();
  });
});
