import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  authSettings,
  captchaFields,
  parseEmailSections,
  passwordFields,
  rateLimitFields,
  smtpFields,
  templateFields,
  urlFields,
} from "./supabase-auth-settings.mjs";

const toml = `
[auth]
minimum_password_length = 12
password_requirements = "lower_upper_letters_digits"

[auth.rate_limit]
email_sent = 40
sms_sent = 30
token_refresh = 120
sign_in_sign_ups = 20
token_verifications = 25

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

const readTemplate = async (file: string) => `<html>${file}</html>`;

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
    const fields = await templateFields(toml, readTemplate);
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

describe("passwordFields", () => {
  it("maps the length and the character classes like the Supabase CLI", () => {
    expect(passwordFields(toml)).toEqual({
      password_min_length: 12,
      password_required_characters: "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
    });
  });

  it("reads the policy of the real config.toml: 10 characters, a letter and a digit", async () => {
    const real = await readFile("supabase/config.toml", "utf8");
    expect(passwordFields(real)).toEqual({
      password_min_length: 10,
      password_required_characters: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
    });
  });

  it("refuses a value Supabase does not know", () => {
    expect(() => passwordFields('[auth]\nminimum_password_length = 4\npassword_requirements = ""')).toThrow();
    expect(() =>
      passwordFields('[auth]\nminimum_password_length = 10\npassword_requirements = "symbols"'),
    ).toThrow(/password_requirements/);
  });
});

describe("rateLimitFields", () => {
  it("maps the limits with the CLI's field names, without the e-mail one", () => {
    expect(rateLimitFields(toml, false)).toEqual({
      rate_limit_otp: 20,
      rate_limit_verify: 25,
      rate_limit_token_refresh: 120,
    });
  });

  it("adds the e-mail limit with custom SMTP", () => {
    expect(rateLimitFields(toml, true)).toMatchObject({ rate_limit_email_sent: 40 });
  });

  it("reads the limits of the real config.toml", async () => {
    const real = await readFile("supabase/config.toml", "utf8");
    expect(rateLimitFields(real, true)).toEqual({
      rate_limit_otp: 30,
      rate_limit_verify: 30,
      rate_limit_token_refresh: 150,
      rate_limit_email_sent: 30,
    });
  });

  it("refuses a missing limit", () => {
    expect(() => rateLimitFields("[auth.rate_limit]\ntoken_refresh = 150", false)).toThrow(
      /sign_in_sign_ups/,
    );
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

describe("captchaFields", () => {
  const secret = "0x4AAAAAAAtestsecret";

  it("leaves the captcha as it is without AUTH_CAPTCHA_ENABLED, even with a secret", () => {
    expect(captchaFields({})).toBeNull();
    expect(captchaFields({ TURNSTILE_SECRET_KEY: secret })).toBeNull();
  });

  it("turns Turnstile on with the secret once AUTH_CAPTCHA_ENABLED is true", () => {
    expect(captchaFields({ AUTH_CAPTCHA_ENABLED: "true", TURNSTILE_SECRET_KEY: ` ${secret} ` })).toEqual({
      security_captcha_enabled: true,
      security_captcha_provider: "turnstile",
      security_captcha_secret: secret,
    });
  });

  it("refuses to turn it on without the secret", () => {
    expect(() => captchaFields({ AUTH_CAPTCHA_ENABLED: "true" })).toThrow(/TURNSTILE_SECRET_KEY/);
  });

  it("turns it off with false, without sending the secret", () => {
    expect(captchaFields({ AUTH_CAPTCHA_ENABLED: "false", TURNSTILE_SECRET_KEY: secret })).toEqual({
      security_captcha_enabled: false,
    });
  });

  it("refuses any other value", () => {
    expect(() => captchaFields({ AUTH_CAPTCHA_ENABLED: "yes", TURNSTILE_SECRET_KEY: secret })).toThrow();
  });
});

describe("authSettings", () => {
  const env = {
    SMTP_PASS: "re_secret_value",
    SMTP_ADMIN_EMAIL: "noreply@email.kolab.test",
    AUTH_SITE_URL: "https://kolab.test",
    AUTH_CAPTCHA_ENABLED: "true",
    TURNSTILE_SECRET_KEY: "0x4AAAAAAAtestsecret",
  };

  it("sends every group once the environment has them", async () => {
    const { body, notes } = await authSettings(toml, env, readTemplate);
    expect(body).toMatchObject({
      mailer_subjects_confirmation: "Confirmez votre adresse e-mail",
      password_min_length: 12,
      rate_limit_otp: 20,
      rate_limit_email_sent: 40,
      smtp_pass: "re_secret_value",
      site_url: "https://kolab.test",
      security_captcha_enabled: true,
    });
    expect(notes).toEqual([]);
  });

  it("says what stays as it is, without printing a secret", async () => {
    const { body, notes } = await authSettings(
      toml,
      { TURNSTILE_SECRET_KEY: "0x4AAAAAAAtestsecret" },
      readTemplate,
    );
    expect(Object.keys(body).some((key) => key.startsWith("smtp_") || key.startsWith("security_"))).toBe(
      false,
    );
    expect(body).not.toHaveProperty("rate_limit_email_sent");
    expect(notes).toHaveLength(3);
    expect(notes.join("\n")).toContain("AUTH_CAPTCHA_ENABLED");
    expect(notes.join("\n")).not.toContain("0x4AAAAAAAtestsecret");
  });
});
