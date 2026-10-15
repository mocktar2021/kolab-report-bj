import "server-only";
import { z } from "zod";
import { log } from "@/lib/log";

// FedaPay settings and the fail-closed rules of ADR 001, section 8.9.
//
// - Production (APP_ENV or VERCEL_ENV is "production") takes real money:
//   only FEDAPAY_ENVIRONMENT=live, and no FEDAPAY_API_BASE_URL.
// - Anywhere else, live is refused, so a preview can never take real money.
// - "mock" is for local work and CI, against tests/fedapay-mock/server.mjs,
//   and only on a loopback address.
// - A broken rule never throws. It turns checkout or the webhook off and
//   says which rule failed, so the other pages keep working.
//
// Key values never leave this module in a log line, only the rule names.

type Env = Record<string, string | undefined>;

export const FEDAPAY_ENVIRONMENTS = ["sandbox", "live", "mock"] as const;

export type FedapayEnvironment = (typeof FEDAPAY_ENVIRONMENTS)[number];

/** Where each environment's API lives (ADR 001, section 14). The mock's port is the one Playwright starts. */
export const FEDAPAY_API_URLS: Record<FedapayEnvironment, string> = {
  sandbox: "https://sandbox-api.fedapay.com",
  live: "https://api.fedapay.com",
  mock: "http://127.0.0.1:4010",
};

/** One code per rule of ADR 001, section 8.9. Logged as is, with no value next to it. */
export type BillingSettingsProblem =
  | "environment_missing"
  | "environment_invalid"
  | "live_outside_production"
  | "not_live_in_production"
  | "base_url_in_production"
  | "base_url_invalid"
  | "base_url_not_allowed"
  | "secret_key_missing"
  | "secret_key_wrong_mode"
  | "webhook_secret_missing"
  | "webhook_secret_wrong_mode";

/** What the FedaPay client needs. Server-side only: it holds the secret key. */
export type FedapayConfig = {
  environment: FedapayEnvironment;
  /** Origin with no trailing slash, for example https://sandbox-api.fedapay.com. */
  apiBaseUrl: string;
  secretKey: string;
};

export type BillingSettings = {
  production: boolean;
  /** Null when FEDAPAY_ENVIRONMENT is unset or not one of FEDAPAY_ENVIRONMENTS. */
  environment: FedapayEnvironment | null;
  /** Checkout, the return page and the reconciliation call FedaPay with it. Null when a rule fails. */
  api: FedapayConfig | null;
  /**
   * The webhook checks signatures with `secret` and re-reads the transaction
   * with `api`. Null when a rule fails: the webhook then answers 503.
   */
  webhook: { secret: string; api: FedapayConfig } | null;
  /** Operator address for billing alerts, null when unset or not an e-mail. */
  alertEmail: string | null;
  /** Every rule that failed. Empty when checkout and the webhook are both on. */
  problems: BillingSettingsProblem[];
};

function trimmed(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/** A secret that is set and is not the "your-..." placeholder of .env.example. */
function secret(value: string | undefined): string | null {
  const text = trimmed(value);
  return text && !text.startsWith("your-") ? text : null;
}

/**
 * The mode a key or webhook secret shows in its prefix, if any. FedaPay's
 * docs show "wh_sandbox..." webhook secrets; the same check on "sk_" keys is
 * a bonus. Keys without such a prefix pass (ADR 001, section 14).
 */
function keyMode(value: string, kind: "sk" | "wh"): "sandbox" | "live" | null {
  if (value.startsWith(`${kind}_sandbox`)) return "sandbox";
  if (value.startsWith(`${kind}_live`)) return "live";
  return null;
}

/** A sandbox key in live, or a live key anywhere else, is a mix-up. */
function wrongMode(environment: FedapayEnvironment, mode: "sandbox" | "live" | null): boolean {
  if (mode === null) return false;
  return environment === "live" ? mode !== "live" : mode === "live";
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

type BaseUrl = { url: string } | { problem: BillingSettingsProblem };

/**
 * The API origin: FEDAPAY_API_BASE_URL when set, else the environment's own.
 * The override is for the mock and tests, so it must be a loopback address
 * (or the environment's own origin, which changes nothing). In production
 * any override is refused. The mock's own origin is a loopback address, so
 * a mock key never reaches another host.
 */
function baseUrl(environment: FedapayEnvironment, override: string | null, production: boolean): BaseUrl {
  const own = FEDAPAY_API_URLS[environment];
  if (override === null) return { url: own };
  if (production) return { problem: "base_url_in_production" };

  let parsed: URL;
  try {
    parsed = new URL(override);
  } catch {
    return { problem: "base_url_invalid" };
  }
  const originOnly =
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    !parsed.username &&
    !parsed.password &&
    parsed.pathname === "/" &&
    !parsed.search &&
    !parsed.hash;
  if (!originOnly) return { problem: "base_url_invalid" };
  if (parsed.origin === own || LOOPBACK_HOSTS.has(parsed.hostname)) return { url: parsed.origin };
  return { problem: "base_url_not_allowed" };
}

export function readBillingSettings(env: Env): BillingSettings {
  const production = env.APP_ENV === "production" || env.VERCEL_ENV === "production";
  const alertEmail = z.string().email().safeParse(trimmed(env.BILLING_ALERT_EMAIL)).data ?? null;
  const off = (environment: FedapayEnvironment | null, problems: BillingSettingsProblem[]) => ({
    production,
    environment,
    api: null,
    webhook: null,
    alertEmail,
    problems,
  });

  const rawEnvironment = trimmed(env.FEDAPAY_ENVIRONMENT)?.toLowerCase() ?? null;
  if (rawEnvironment === null) return off(null, ["environment_missing"]);
  const parsed = z.enum(FEDAPAY_ENVIRONMENTS).safeParse(rawEnvironment);
  if (!parsed.success) return off(null, ["environment_invalid"]);
  const environment = parsed.data;

  if (production && environment !== "live") return off(environment, ["not_live_in_production"]);
  if (!production && environment === "live") return off(environment, ["live_outside_production"]);

  const base = baseUrl(environment, trimmed(env.FEDAPAY_API_BASE_URL), production);
  if ("problem" in base) return off(environment, [base.problem]);

  const secretKey = secret(env.FEDAPAY_SECRET_KEY);
  const webhookSecret = secret(env.FEDAPAY_WEBHOOK_SECRET);
  const problems: BillingSettingsProblem[] = [];
  if (secretKey === null) problems.push("secret_key_missing");
  else if (wrongMode(environment, keyMode(secretKey, "sk"))) problems.push("secret_key_wrong_mode");
  if (webhookSecret === null) problems.push("webhook_secret_missing");
  else if (wrongMode(environment, keyMode(webhookSecret, "wh"))) problems.push("webhook_secret_wrong_mode");

  // A key from the wrong mode means the settings are mixed up: nothing runs.
  if (problems.includes("secret_key_wrong_mode") || problems.includes("webhook_secret_wrong_mode")) {
    return off(environment, problems);
  }
  const api = secretKey === null ? null : { environment, apiBaseUrl: base.url, secretKey };
  // Without a webhook secret, checkout still works: the return page and the
  // reconciliation grant the purchase (ADR 001, section 8.6).
  const webhook = api && webhookSecret ? { secret: webhookSecret, api } : null;
  return { production, environment, api, webhook, alertEmail, problems };
}

const reported = new Set<string>();

/**
 * The settings of this deployment. The first time a set of problems shows
 * up in a process, logs "billing: misconfigured" with the rule codes: an
 * error in production, a warning elsewhere, where billing is often left off.
 */
export function getBillingSettings(): BillingSettings {
  const settings = readBillingSettings(process.env);
  if (settings.problems.length > 0) {
    const key = `${settings.environment}:${settings.problems.join(",")}`;
    if (!reported.has(key)) {
      reported.add(key);
      const fields = {
        environment: settings.environment,
        production: settings.production,
        problems: settings.problems,
      };
      if (settings.production) log.error("billing: misconfigured", fields);
      else log.warn("billing: misconfigured", fields);
    }
  }
  return settings;
}
