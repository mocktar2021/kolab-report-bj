// Checks the settings of one environment before a deploy and after any change
// (KRB-157): the secrets and variables of its GitHub environment, the Vercel
// variables of its target, and on production that nothing points at the
// staging project. It reports names and verdicts, never a value, and never
// asks Vercel to decrypt a variable: values are only compared when the API
// returns them in clear (plain variables), and only inside this process.
//
//   CHECK_ENVIRONMENT=production node scripts/check-settings.mjs
//
// Run by .github/workflows/check-settings.yml, which passes whether each
// secret is set (SECRET_<NAME>=true|false), each variable (VAR_<NAME>), the
// staging project ref and fingerprints of the server actions key.
// Setup: docs/deployment.md, "Check the settings".
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ORIGINS = { production: "https://kolabreport.com", staging: "https://kolabreport.mocktar.com" };
const VERCEL_TARGETS = { production: "production", staging: "preview" };

/** The GitHub environment: what deploy.yml needs, then optional groups. */
export const GITHUB = {
  secrets: [
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_DB_PASSWORD",
    "VERCEL_TOKEN",
    "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
  ],
  variables: ["SUPABASE_PROJECT_REF", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"],
  groups: [
    {
      name: "Database backup",
      why: "the nightly dump, the only copy of the database on the Supabase free plan",
      secrets: ["SUPABASE_DB_URL"],
      variables: ["BACKUP_AGE_RECIPIENT"],
    },
    {
      name: "Auth URLs",
      why: "the site and redirect URLs of the sign-in e-mails (supabase-auth-settings.yml)",
      secrets: [],
      variables: ["AUTH_SITE_URL"],
    },
    {
      name: "Auth e-mails",
      why: "the custom SMTP sender, without which Supabase sends about 30 e-mails an hour to its team only",
      secrets: ["SMTP_PASS"],
      variables: ["SMTP_ADMIN_EMAIL"],
    },
    {
      name: "Smoke tests",
      why: "the checks that run after each deploy",
      secrets: ["SMOKE_EMAIL", "SMOKE_PASSWORD"],
      variables: ["SMOKE_BASE_URL"],
    },
    {
      name: "Sentry",
      why: "error reports with readable stack traces",
      secrets: ["SENTRY_AUTH_TOKEN"],
      variables: ["SENTRY_ORG", "SENTRY_PROJECT", "NEXT_PUBLIC_SENTRY_DSN"],
    },
  ],
};

/** Vercel variables of the environment's target, from docs/deployment.md. */
export const VERCEL = {
  // The app does not start, or its sign-in or scheduled jobs fail, without them.
  required: [
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "APP_ENV",
  ],
  // Required on production only. Vercel runs the scheduled jobs on production
  // deployments only, so elsewhere they serve only to run a job by hand.
  productionOnly: ["CRON_SECRET"],
  // A feature that stays off without its variables, and breaks with half of them.
  groups: [
    {
      name: "Payments",
      why: "payments stay off",
      all: ["FEDAPAY_ENVIRONMENT", "FEDAPAY_SECRET_KEY", "FEDAPAY_WEBHOOK_SECRET"],
      oneOf: [],
    },
    {
      name: "E-mails",
      why: "the app shows invitation links to copy instead of sending e-mails",
      all: ["EMAIL_PROVIDER", "EMAIL_FROM"],
      oneOf: ["RESEND_API_KEY", "BREVO_API_KEY"],
    },
    {
      name: "AI",
      why: "AI drafts and the template helper stay off",
      all: [],
      oneOf: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
    },
  ],
  recommended: ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "ACCOUNT_DELETION_LOG_EMAIL", "BILLING_ALERT_EMAIL"],
  // Marked Sensitive, so they cannot be read back from the dashboard.
  secrets: [
    "SUPABASE_SERVICE_ROLE_KEY",
    "DATABASE_URL",
    "DIRECT_URL",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "LANGFUSE_SECRET_KEY",
    "RESEND_API_KEY",
    "BREVO_API_KEY",
    "CRON_SECRET",
    "FEDAPAY_SECRET_KEY",
    "FEDAPAY_WEBHOOK_SECRET",
  ],
};

const finding = (level, where, name, message) => ({ level, where, name, message });

/** Checks of the GitHub environment, from the SECRET_* and VAR_* entries of env. */
export function checkGitHub(environment, env) {
  const findings = [];
  const isSet = (kind, name) =>
    kind === "secret" ? env[`SECRET_${name}`] === "true" : Boolean(env[`VAR_${name}`]?.trim());

  for (const name of GITHUB.secrets) {
    findings.push(
      isSet("secret", name)
        ? finding("ok", "GitHub", name, "set")
        : finding("error", "GitHub", name, "secret missing: deploy.yml stops without it"),
    );
  }
  for (const name of GITHUB.variables) {
    findings.push(
      isSet("variable", name)
        ? finding("ok", "GitHub", name, "set")
        : finding("error", "GitHub", name, "variable missing: deploy.yml stops without it"),
    );
  }

  for (const group of GITHUB.groups) {
    const names = [
      ...group.secrets.map((name) => ["secret", name]),
      ...group.variables.map((name) => ["variable", name]),
    ];
    const missing = names.filter(([kind, name]) => !isSet(kind, name)).map(([, name]) => name);
    if (missing.length === 0) findings.push(finding("ok", "GitHub", group.name, "set"));
    else if (missing.length === names.length)
      findings.push(finding("warn", "GitHub", group.name, `not set: ${group.why}`));
    else findings.push(finding("warn", "GitHub", group.name, `partly set, missing ${missing.join(", ")}`));
  }

  const origin = ORIGINS[environment];
  for (const name of ["AUTH_SITE_URL", "SMOKE_BASE_URL"]) {
    const value = env[`VAR_${name}`]?.trim();
    if (value && value.replace(/\/+$/, "") !== origin)
      findings.push(finding("error", "GitHub", name, `is not ${origin}`));
  }

  if (environment === "production") {
    const ref = env.VAR_SUPABASE_PROJECT_REF?.trim();
    const stagingRef = env.STAGING_PROJECT_REF?.trim();
    if (ref && stagingRef && ref === stagingRef)
      findings.push(finding("error", "GitHub", "SUPABASE_PROJECT_REF", "is the staging project"));
    else if (ref && stagingRef)
      findings.push(finding("ok", "GitHub", "SUPABASE_PROJECT_REF", "differs from staging"));

    const key = env.ACTIONS_KEY?.trim();
    const stagingKey = env.STAGING_ACTIONS_KEY?.trim();
    if (key && stagingKey && key === stagingKey)
      findings.push(
        finding(
          "error",
          "GitHub",
          "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
          "same as staging: use one key per environment",
        ),
      );
    else if (key && stagingKey)
      findings.push(finding("ok", "GitHub", "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", "differs from staging"));
  }
  return findings;
}

/** The `ref` claim of a Supabase JWT key, or null when the key is not a JWT. */
export function jwtRef(key) {
  const payload = key.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims.ref === "string" ? claims.ref : null;
  } catch {
    return null;
  }
}

/**
 * Checks of the Vercel variables of the environment's target. `variables` is
 * the `envs` list of GET /v10/projects/{id}/env, read without decrypting.
 */
export function checkVercel(environment, variables, projectRef) {
  const findings = [];
  const target = VERCEL_TARGETS[environment];
  const mine = variables.filter(
    (variable) => Array.isArray(variable.target) && variable.target.includes(target),
  );
  const byKey = new Map(mine.map((variable) => [variable.key, variable]));
  // A value is only compared when Vercel returned it in clear.
  const readable = (key) => {
    const variable = byKey.get(key);
    if (!variable || typeof variable.value !== "string") return null;
    return variable.type === "plain" || variable.decrypted === true ? variable.value : null;
  };

  for (const key of VERCEL.required) {
    findings.push(
      byKey.has(key)
        ? finding("ok", "Vercel", key, "set")
        : finding("error", "Vercel", key, `missing on ${target}`),
    );
  }
  for (const key of VERCEL.productionOnly) {
    if (byKey.has(key)) findings.push(finding("ok", "Vercel", key, "set"));
    else if (environment === "production")
      findings.push(finding("error", "Vercel", key, `missing on ${target}`));
    else
      findings.push(
        finding("warn", "Vercel", key, `not set on ${target}: only needed to run a scheduled job by hand`),
      );
  }
  for (const group of VERCEL.groups) {
    const missing = group.all.filter((key) => !byKey.has(key));
    const keyFound = group.oneOf.length === 0 || group.oneOf.some((key) => byKey.has(key));
    if (!keyFound) missing.push(group.oneOf.join(" or "));
    const anySet = [...group.all, ...group.oneOf].some((key) => byKey.has(key));
    if (missing.length === 0) findings.push(finding("ok", "Vercel", group.name, "set"));
    else if (!anySet)
      findings.push(finding("warn", "Vercel", group.name, `not set on ${target}: ${group.why}`));
    else
      findings.push(
        finding("error", "Vercel", group.name, `partly set on ${target}, missing ${missing.join(", ")}`),
      );
  }
  for (const key of VERCEL.recommended) {
    if (!byKey.has(key)) findings.push(finding("warn", "Vercel", key, `not set on ${target}`));
  }
  if (environment === "production" && byKey.has("FEDAPAY_API_BASE_URL"))
    findings.push(finding("error", "Vercel", "FEDAPAY_API_BASE_URL", "set on production, which refuses it"));

  for (const variable of mine) {
    if (variable.key.startsWith("NEXT_PUBLIC_") && variable.type === "sensitive")
      findings.push(
        finding("error", "Vercel", variable.key, "marked Sensitive: the build cannot read it and stops"),
      );
    if (VERCEL.secrets.includes(variable.key) && variable.type !== "sensitive")
      findings.push(finding("warn", "Vercel", variable.key, "not marked Sensitive"));
  }

  const expected = {
    APP_ENV: environment,
    NEXT_PUBLIC_APP_URL: ORIGINS[environment],
    FEDAPAY_ENVIRONMENT: environment === "production" ? "live" : "sandbox",
  };
  for (const [key, value] of Object.entries(expected)) {
    const actual = readable(key);
    if (actual !== null && actual.trim().replace(/\/+$/, "") !== value)
      findings.push(finding("error", "Vercel", key, `is not ${value}`));
  }

  if (projectRef) {
    const url = readable("NEXT_PUBLIC_SUPABASE_URL");
    if (url !== null) {
      let host = "";
      try {
        host = new URL(url).hostname;
      } catch {
        // Not a URL: reported below as not this project.
      }
      findings.push(
        host === `${projectRef}.supabase.co`
          ? finding("ok", "Vercel", "NEXT_PUBLIC_SUPABASE_URL", "points at this environment's project")
          : finding("error", "Vercel", "NEXT_PUBLIC_SUPABASE_URL", "does not point at SUPABASE_PROJECT_REF"),
      );
    }
    const anonKey = readable("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const ref = anonKey === null ? null : jwtRef(anonKey);
    if (ref !== null)
      findings.push(
        ref === projectRef
          ? finding("ok", "Vercel", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "belongs to this environment's project")
          : finding("error", "Vercel", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "belongs to another project"),
      );
  }
  return findings;
}

const ICONS = { ok: "✓", warn: "!", error: "✗" };

/** Plain lines for the log and a Markdown table for the run summary. */
export function report(environment, findings) {
  const errors = findings.filter((item) => item.level === "error").length;
  const warnings = findings.filter((item) => item.level === "warn").length;
  const verdict =
    errors > 0
      ? `${errors} to fix, ${warnings} to look at.`
      : warnings > 0
        ? `Ready to deploy, ${warnings} to look at.`
        : "Ready to deploy.";
  const lines = findings.map((item) => `${ICONS[item.level]} ${item.where} ${item.name}: ${item.message}`);
  const rows = findings.map(
    (item) => `| ${ICONS[item.level]} | ${item.where} | \`${item.name}\` | ${item.message} |`,
  );
  const markdown = [
    `## Settings of ${environment}`,
    "",
    verdict,
    "",
    "| | Where | Name | Result |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
  return { lines: [...lines, verdict], markdown, ok: errors === 0 };
}

async function vercelVariables(env) {
  const team = env.VAR_VERCEL_ORG_ID?.trim();
  const project = env.VAR_VERCEL_PROJECT_ID?.trim();
  const url = new URL(`https://api.vercel.com/v10/projects/${encodeURIComponent(project)}/env`);
  if (team?.startsWith("team_")) url.searchParams.set("teamId", team);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`The Vercel API answered ${response.status} for the project's variables.`);
  const body = await response.json();
  return Array.isArray(body) ? body : (body.envs ?? []);
}

async function main() {
  const env = process.env;
  const environment = env.CHECK_ENVIRONMENT;
  if (!(environment in ORIGINS)) {
    console.error("CHECK_ENVIRONMENT must be production or staging.");
    process.exit(1);
  }

  const findings = checkGitHub(environment, env);
  if (env.VERCEL_TOKEN && env.VAR_VERCEL_PROJECT_ID?.trim()) {
    try {
      const variables = await vercelVariables(env);
      findings.push(...checkVercel(environment, variables, env.VAR_SUPABASE_PROJECT_REF?.trim()));
    } catch (error) {
      findings.push(
        finding("error", "Vercel", "API", error instanceof Error ? error.message : String(error)),
      );
    }
  } else {
    findings.push(
      finding("error", "Vercel", "API", "not checked: VERCEL_TOKEN or VERCEL_PROJECT_ID is missing"),
    );
  }

  const { lines, markdown, ok } = report(environment, findings);
  for (const line of lines) console.log(line);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, markdown);
  if (!ok) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
