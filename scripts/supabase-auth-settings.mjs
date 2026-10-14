// Pushes the Supabase Auth e-mails of the repository to a hosted project
// (KRB-170): the French subjects and templates declared in
// supabase/config.toml, and, when the environment has them, the custom SMTP
// sender and the site and redirect URLs. It sends only those fields through
// the Management API (PATCH /v1/projects/{ref}/config/auth), so every other
// Auth setting of the project stays as it is. `supabase config push` would
// send the whole local [auth] section, localhost URLs included.
//
//   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... node scripts/supabase-auth-settings.mjs [--dry-run]
//
// Run by .github/workflows/supabase-auth-settings.yml. Setup: docs/deployment.md.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The e-mail sections of a Supabase config.toml: [auth.email.template.<name>]
 * and [auth.email.notification.<name>], with their subject, content_path and
 * enabled keys. Enough TOML for those sections, not a general parser.
 */
export function parseEmailSections(toml) {
  const sections = { template: {}, notification: {} };
  let current = null;
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      const parts = header[1].split(".");
      current =
        parts.length === 4 && parts[0] === "auth" && parts[1] === "email" && parts[2] in sections
          ? (sections[parts[2]][parts[3]] = {})
          : null;
      continue;
    }
    if (!current) continue;
    const pair = line.match(/^([a-z_]+)\s*=\s*(.+?)\s*(#.*)?$/);
    if (!pair) continue;
    const [, key, value] = pair;
    if (value === "true" || value === "false") current[key] = value === "true";
    else if (value.startsWith('"')) current[key] = JSON.parse(value);
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
  const smtp = smtpFields(process.env);
  const urls = urlFields(process.env);
  const body = { ...(await templateFields(toml)), ...smtp, ...urls };

  // Field names only: the templates are long and smtp_pass is a secret.
  console.log(`Fields to set (${Object.keys(body).length}):`);
  for (const key of Object.keys(body).sort()) console.log(`  ${key}`);
  if (!smtp) console.log("No SMTP_PASS or SMTP_ADMIN_EMAIL: the SMTP settings stay as they are.");
  if (!urls) console.log("No AUTH_SITE_URL: the site URL and redirect URLs stay as they are.");
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

  // Read back the subjects, which are short and not secret, as a check.
  const saved = await response.json();
  const wrong = Object.keys(body).filter(
    (key) => key.startsWith("mailer_subjects_") && saved[key] !== undefined && saved[key] !== body[key],
  );
  if (wrong.length > 0) {
    console.error(`Saved, but these subjects read back differently: ${wrong.join(", ")}`);
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
