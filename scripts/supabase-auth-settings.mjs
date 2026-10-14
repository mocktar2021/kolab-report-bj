// Pushes the Supabase Auth settings of the repository to a hosted project:
// the French subjects and templates (KRB-170), the password policy and the
// rate limits declared in supabase/config.toml (KRB-58), and, when the
// environment has them, the custom SMTP sender, the site and redirect URLs
// and the Turnstile captcha. It sends only those fields through the
// Management API (PATCH /v1/projects/{ref}/config/auth), so every other Auth
// setting of the project stays as it is. `supabase config push` would send the
// whole local [auth] section, localhost URLs included.
//
//   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... node scripts/supabase-auth-settings.mjs [--dry-run]
//
// Run by .github/workflows/supabase-auth-settings.yml. Setup: docs/deployment.md.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every [section] of a config.toml with its string, whole number and boolean
 * keys. Enough TOML for supabase/config.toml, not a general parser: arrays and
 * inline tables are skipped.
 */
export function parseSections(toml) {
  const sections = {};
  let current = null;
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      current = sections[header[1]] ??= {};
      continue;
    }
    if (!current) continue;
    const pair = line.match(/^([a-z_]+)\s*=\s*(.+?)\s*(#.*)?$/);
    if (!pair) continue;
    const [, key, value] = pair;
    if (value === "true" || value === "false") current[key] = value === "true";
    else if (/^\d+$/.test(value)) current[key] = Number(value);
    else if (value.startsWith('"')) current[key] = JSON.parse(value);
  }
  return sections;
}

/**
 * The e-mail sections of a Supabase config.toml: [auth.email.template.<name>]
 * and [auth.email.notification.<name>], with their subject, content_path and
 * enabled keys.
 */
export function parseEmailSections(toml) {
  const sections = { template: {}, notification: {} };
  for (const [name, values] of Object.entries(parseSections(toml))) {
    const parts = name.split(".");
    if (parts.length === 4 && parts[0] === "auth" && parts[1] === "email" && parts[2] in sections) {
      sections[parts[2]][parts[3]] = values;
    }
  }
  return sections;
}

/** The Management API fields for the subjects and templates, read from the repository. */
export async function templateFields(toml, read = (file) => readFile(path.join(root, file), "utf8")) {
  const { template, notification } = parseEmailSections(toml);
  const fields = {};
  for (const [name, section] of Object.entries(template)) {
    if (!section.subject || !section.content_path)
      throw new Error(`[auth.email.template.${name}] needs a subject and a content_path`);
    fields[`mailer_subjects_${name}`] = section.subject;
    fields[`mailer_templates_${name}_content`] = await read(section.content_path);
  }
  for (const [name, section] of Object.entries(notification)) {
    if (section.enabled !== undefined) fields[`mailer_notifications_${name}_enabled`] = section.enabled;
    if (section.subject) fields[`mailer_subjects_${name}_notification`] = section.subject;
    if (section.content_path)
      fields[`mailer_templates_${name}_notification_content`] = await read(section.content_path);
  }
  if (Object.keys(fields).length === 0) throw new Error("supabase/config.toml declares no e-mail template");
  return fields;
}

// password_requirements of config.toml -> password_required_characters of the
// Management API: character sets separated by ":", one character of each set
// required. Same values as the Supabase CLI.
const REQUIRED_CHARACTERS = {
  "": "",
  letters_digits: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
  lower_upper_letters_digits: "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
  lower_upper_letters_digits_symbols:
    "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};'\\\\:\"|<>?,./`~",
};

/** Password policy, from minimum_password_length and password_requirements of [auth]. */
export function passwordFields(toml) {
  const auth = parseSections(toml).auth ?? {};
  const minLength = auth.minimum_password_length;
  if (!Number.isInteger(minLength) || minLength < 6)
    throw new Error("[auth] minimum_password_length must be a whole number, 6 or more");
  const requirements = auth.password_requirements ?? "";
  if (!Object.hasOwn(REQUIRED_CHARACTERS, requirements))
    throw new Error(`[auth] password_requirements "${requirements}" is not a Supabase value`);
  return {
    password_min_length: minLength,
    password_required_characters: REQUIRED_CHARACTERS[requirements],
  };
}

// [auth.rate_limit] key -> Management API field, the mapping of the Supabase
// CLI. sign_in_sign_ups covers sign-up, reset requests, resends and password
// changes; token_refresh covers password sign-in and session refreshes.
// SMS, anonymous and Web3 sign-ins are off, so their limits are not sent.
const RATE_LIMITS = {
  sign_in_sign_ups: "rate_limit_otp",
  token_verifications: "rate_limit_verify",
  token_refresh: "rate_limit_token_refresh",
};

/**
 * Rate limits from [auth.rate_limit]. The e-mail limit only applies to custom
 * SMTP, so it goes with the SMTP settings, as with the Supabase CLI.
 */
export function rateLimitFields(toml, withSmtp) {
  const limits = parseSections(toml)["auth.rate_limit"] ?? {};
  const mapping = withSmtp ? { ...RATE_LIMITS, email_sent: "rate_limit_email_sent" } : RATE_LIMITS;
  const fields = {};
  for (const [key, field] of Object.entries(mapping)) {
    const value = limits[key];
    if (!Number.isInteger(value) || value < 1)
      throw new Error(`[auth.rate_limit] ${key} must be a whole number, 1 or more`);
    fields[field] = value;
  }
  return fields;
}

/**
 * Custom SMTP, only when the password and the sender address are set. The
 * defaults fit Resend (smtp.resend.com, port 465, user "resend", the API key
 * as password).
 */
export function smtpFields(env) {
  const pass = env.SMTP_PASS?.trim();
  const adminEmail = env.SMTP_ADMIN_EMAIL?.trim();
  if (!pass || !adminEmail) return null;
  return {
    smtp_host: env.SMTP_HOST?.trim() || "smtp.resend.com",
    // The Management API takes the port as text and answers 400 to a number.
    smtp_port: env.SMTP_PORT?.trim() || "465",
    smtp_user: env.SMTP_USER?.trim() || "resend",
    smtp_pass: pass,
    smtp_admin_email: adminEmail,
    smtp_sender_name: env.SMTP_SENDER_NAME?.trim() || "KolabReport",
  };
}

/** Site URL and redirect allow list, only when AUTH_SITE_URL is set. */
export function urlFields(env) {
  const siteUrl = env.AUTH_SITE_URL?.trim().replace(/\/+$/, "");
  if (!siteUrl) return null;
  if (!/^https:\/\/[^/\s]+$/.test(siteUrl))
    throw new Error("AUTH_SITE_URL must be an https origin, without a path");
  const extra = (env.AUTH_REDIRECT_URLS ?? "")
    .split(/[\s,]+/)
    .map((url) => url.trim())
    .filter(Boolean);
  return { site_url: siteUrl, uri_allow_list: [`${siteUrl}/**`, ...extra].join(",") };
}

/**
 * Turnstile captcha. Supabase then refuses sign-ups, sign-ins and reset
 * requests without a token, so it only turns on when AUTH_CAPTCHA_ENABLED is
 * "true", which says the app with NEXT_PUBLIC_TURNSTILE_SITE_KEY is live, and
 * TURNSTILE_SECRET_KEY is set. "false" turns it off. Unset leaves it as it is.
 */
export function captchaFields(env) {
  const enabled = env.AUTH_CAPTCHA_ENABLED?.trim().toLowerCase();
  if (!enabled) return null;
  if (enabled === "false") return { security_captcha_enabled: false };
  if (enabled !== "true") throw new Error('AUTH_CAPTCHA_ENABLED must be "true" or "false"');
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) throw new Error("AUTH_CAPTCHA_ENABLED is true but TURNSTILE_SECRET_KEY is not set");
  return {
    security_captcha_enabled: true,
    security_captcha_provider: "turnstile",
    security_captcha_secret: secret,
  };
}

/**
 * Everything to send, and a note for each group of settings left as it is.
 * The notes name variables, never their values.
 */
export async function authSettings(toml, env, read) {
  const smtp = smtpFields(env);
  const urls = urlFields(env);
  const captcha = captchaFields(env);
  const body = {
    ...(await templateFields(toml, read)),
    ...passwordFields(toml),
    ...rateLimitFields(toml, Boolean(smtp)),
    ...smtp,
    ...urls,
    ...captcha,
  };
  const notes = [];
  if (!smtp)
    notes.push(
      "No SMTP_PASS or SMTP_ADMIN_EMAIL: the SMTP settings and the e-mail rate limit stay as they are.",
    );
  if (!urls) notes.push("No AUTH_SITE_URL: the site URL and redirect URLs stay as they are.");
  if (!captcha) {
    notes.push(
      env.TURNSTILE_SECRET_KEY?.trim()
        ? 'TURNSTILE_SECRET_KEY is set but AUTH_CAPTCHA_ENABLED is not "true": the captcha stays as it is.'
        : "No AUTH_CAPTCHA_ENABLED: the captcha stays as it is.",
    );
  } else if (!captcha.security_captcha_enabled) {
    notes.push("AUTH_CAPTCHA_ENABLED is false: the captcha turns off.");
  }
  return { body, notes };
}

// Fields read back after the call. Not the templates (long) or the secrets.
const CHECKED = /^(mailer_subjects_|password_|rate_limit_|security_captcha_(enabled|provider)$)/;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const ref = process.env.SUPABASE_PROJECT_REF?.trim();
  if (!dryRun && (!token || !ref)) {
    console.error("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required.");
    process.exit(1);
  }
  if (ref && !/^[a-z0-9]+$/.test(ref)) {
    console.error("SUPABASE_PROJECT_REF is not a project ref.");
    process.exit(1);
  }

  const toml = await readFile(path.join(root, "supabase/config.toml"), "utf8");
  const { body, notes } = await authSettings(toml, process.env);

  // Field names only: the templates are long, smtp_pass and
  // security_captcha_secret are secrets.
  console.log(`Fields to set (${Object.keys(body).length}):`);
  for (const key of Object.keys(body).sort()) console.log(`  ${key}`);
  for (const note of notes) console.log(note);
  if (dryRun) return;

  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const message = typeof detail?.message === "string" ? `: ${detail.message.slice(0, 300)}` : "";
    console.error(`The Management API answered ${response.status}${message}`);
    process.exit(1);
  }

  // Read back the short settings that are not secret, as a check.
  const saved = await response.json();
  const wrong = Object.keys(body).filter(
    (key) => CHECKED.test(key) && saved[key] !== undefined && saved[key] !== body[key],
  );
  if (wrong.length > 0) {
    console.error(`Saved, but these fields read back differently: ${wrong.join(", ")}`);
    process.exit(1);
  }
  console.log(`Saved on project ${ref}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
