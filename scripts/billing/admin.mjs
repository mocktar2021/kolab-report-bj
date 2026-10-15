// Shared code of the billing operator scripts (KRB-179): record-payment.mjs,
// grant.mjs and revoke.mjs. They call the billing_admin_* functions of the
// database with the service role key, which only the operator has. Every run
// is a dry run unless --apply is given: it prints the organization, its
// periods and the call it would make, and writes nothing.
//
// Runbook: docs/operations/billing.md ("Institution and manual changes").

/**
 * Limits of each plan, as src/lib/billing/catalog.ts gives them. admin.test.ts
 * fails when the two differ. Null means no limit.
 */
export const PLAN_LIMITS = {
  independant: {
    max_members: 3,
    max_reports: 3,
    drafts_per_month: 60,
    drafts_total: null,
    custom_templates: false,
  },
  cabinet: {
    max_members: 10,
    max_reports: null,
    drafts_per_month: 250,
    drafts_total: null,
    custom_templates: true,
  },
  institution: {
    max_members: null,
    max_reports: null,
    drafts_per_month: 1000,
    drafts_total: null,
    custom_templates: true,
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `--key value` pairs and bare `--flag`s. Values never start with "--". */
export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function required(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`--${key} is required`);
  return value.trim();
}

function uuid(args, key) {
  const value = required(args, key);
  if (!UUID.test(value)) throw new Error(`--${key} must be a uuid`);
  return value.toLowerCase();
}

function wholeNumber(value, name, { min = 1, max = 1_000_000_000 } = {}) {
  const digits = String(value).replace(/[\s_]/g, "");
  if (!/^\d+$/.test(digits)) throw new Error(`${name} must be a whole number`);
  const number = Number(digits);
  if (number < min || number > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return number;
}

/** Who ran the script and why: both go to the audit log. */
function actorAndReason(args) {
  const actor = required(args, "actor");
  const reason = required(args, "reason");
  if (actor.length < 2 || actor.length > 200) throw new Error("--actor must be 2 to 200 characters");
  if (reason.length < 3 || reason.length > 500) throw new Error("--reason must be 3 to 500 characters");
  return { p_actor: actor, p_reason: reason };
}

/**
 * The plan's limits, changed by --members, --reports, --drafts-per-month and
 * --templates. "none" means no limit; --templates takes yes or no.
 */
export function limitsFrom(plan, args) {
  const limits = { ...PLAN_LIMITS[plan] };
  const limit = (key, flag, min) => {
    if (args[flag] === undefined) return;
    limits[key] = args[flag] === "none" ? null : wholeNumber(args[flag], `--${flag}`, { min });
  };
  limit("max_members", "members", 1);
  limit("max_reports", "reports", 1);
  limit("drafts_per_month", "drafts-per-month", 0);
  if (args.templates !== undefined) {
    if (args.templates !== "yes" && args.templates !== "no") throw new Error("--templates must be yes or no");
    limits.custom_templates = args.templates === "yes";
  }
  return limits;
}

/** A day of Benin as a timestamp at noon there, so it stays the same day everywhere. */
function beninNoon(day, name) {
  if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00+01:00`))) {
    throw new Error(`${name} must be a date like 2026-10-15`);
  }
  return `${day}T12:00:00+01:00`;
}

/** Arguments of billing_admin_record_payment, from the command line. */
export function recordPaymentParams(args) {
  const months = args.months === undefined ? 12 : wholeNumber(args.months, "--months", { max: 36 });
  return {
    p_organization_id: uuid(args, "organization"),
    p_amount_ht_xof: wholeNumber(required(args, "amount"), "--amount", { max: 100_000_000 }),
    p_months: months,
    p_limits: limitsFrom("institution", args),
    p_transfer_reference: required(args, "reference"),
    p_paid_at: beninNoon(required(args, "paid-on"), "--paid-on"),
    ...actorAndReason(args),
    p_label: typeof args.label === "string" ? args.label : null,
    p_catalog_version: 1,
    p_test: args.test === true,
  };
}

/** Arguments of billing_admin_grant: a plan for --days or --months, from --start or the next free day. */
export function grantParams(args) {
  const plan = required(args, "plan");
  if (!(plan in PLAN_LIMITS)) throw new Error("--plan must be independant, cabinet or institution");
  if ((args.days === undefined) === (args.months === undefined))
    throw new Error("Give either --days or --months");
  const length =
    args.days !== undefined
      ? `${wholeNumber(args.days, "--days", { max: 1095 })} days`
      : `${wholeNumber(args.months, "--months", { max: 36 })} months`;
  return {
    p_organization_id: uuid(args, "organization"),
    p_plan: plan,
    p_length: length,
    p_limits: limitsFrom(plan, args),
    ...actorAndReason(args),
    p_starts_at: args.start === undefined ? null : beninNoon(required(args, "start"), "--start"),
  };
}

/** Arguments of billing_admin_revoke. */
export function revokeParams(args) {
  return { p_entitlement_id: uuid(args, "entitlement"), ...actorAndReason(args) };
}

/** URL and service role key of the target project, from the environment. */
export function target(env) {
  const url = (env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!/^https?:\/\//.test(url)) throw new Error("Set SUPABASE_URL to the project's URL");
  if (!key) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard, Project Settings, API)");
  return { url, key };
}

async function rest({ url, key }, path, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body && typeof body === "object" && "message" in body ? body.message : text;
    throw new Error(`Supabase answered ${response.status}: ${message}`);
  }
  return body;
}

/** Calls a database function with the service role. */
export function callFunction(project, name, params) {
  return rest(project, `rpc/${name}`, { method: "POST", body: JSON.stringify(params) });
}

/** The organization and its subscription periods that run now or later. */
export async function organizationSummary(project, organizationId, now = new Date()) {
  const [organizations, periods] = await Promise.all([
    rest(project, `organizations?id=eq.${organizationId}&select=id,name`),
    rest(
      project,
      `billing_entitlements?organization_id=eq.${organizationId}&scope=eq.subscription&revoked_at=is.null` +
        `&ends_at=gt.${encodeURIComponent(now.toISOString())}&select=id,plan,source,starts_at,ends_at&order=starts_at`,
    ),
  ]);
  if (!Array.isArray(organizations) || organizations.length === 0) {
    throw new Error(`No organization ${organizationId} in this project`);
  }
  return { name: organizations[0].name, periods };
}

/** One line per period, for the dry run and the result. */
export function formatPeriods(periods) {
  if (periods.length === 0) return ["  (no period running or planned)"];
  return periods.map(
    (period) =>
      `  ${period.plan} (${period.source}) ${period.starts_at.slice(0, 10)} to ${period.ends_at.slice(0, 10)}  id ${period.id}`,
  );
}

/**
 * Runs one operator command: checks the arguments, prints the target, the
 * organization and the call, and makes it only with --apply.
 */
export async function run({ argv, env, describe, build, functionName, log = console.log }) {
  const args = parseArgs(argv);
  const params = build(args);
  const project = target(env);
  log(`Project: ${project.url}`);
  await describe(project, params, log);
  log(`Call: ${functionName}(${JSON.stringify(params, null, 2)})`);
  if (args.apply !== true) {
    log("Dry run: nothing written. Run again with --apply to write.");
    return null;
  }
  const result = await callFunction(project, functionName, params);
  log(`Done: ${JSON.stringify(result, null, 2)}`);
  return result;
}
