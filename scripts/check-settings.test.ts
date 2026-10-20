import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { GITHUB, VERCEL, checkGitHub, checkVercel, jwtRef, report } from "./check-settings.mjs";

const PROD_REF = "krsccuejegzqianrzstc";
const STAGING_REF = "abcdefghijklmnopqrst";

/** Every GitHub setting set, as the workflow passes them. */
function fullGitHub(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {};
  for (const name of GITHUB.secrets) env[`SECRET_${name}`] = "true";
  for (const name of GITHUB.variables) env[`VAR_${name}`] = "x";
  for (const group of GITHUB.groups) {
    for (const name of group.secrets) env[`SECRET_${name}`] = "true";
    for (const name of group.variables) env[`VAR_${name}`] = "x";
  }
  env.VAR_SUPABASE_PROJECT_REF = PROD_REF;
  env.VAR_AUTH_SITE_URL = "https://kolabreport.com";
  env.VAR_SMOKE_BASE_URL = "https://kolabreport.com/";
  return { ...env, ...overrides };
}

const levels = <T extends { level: string }>(findings: T[], level: string) =>
  findings.filter((item) => item.level === level);
const named = <T extends { name: string }>(findings: T[], name: string) =>
  findings.filter((item) => item.name === name);

describe("checkGitHub (KRB-157)", () => {
  it("passes when everything is set and production differs from staging", () => {
    const findings = checkGitHub(
      "production",
      fullGitHub({ STAGING_PROJECT_REF: STAGING_REF, ACTIONS_KEY: "aaaa", STAGING_ACTIONS_KEY: "bbbb" }),
    );
    expect(levels(findings, "error")).toEqual([]);
    expect(levels(findings, "warn")).toEqual([]);
    expect(named(findings, "SUPABASE_PROJECT_REF").at(-1)?.message).toBe("differs from staging");
  });

  it("fails on a missing secret or variable that deploy.yml needs", () => {
    const findings = checkGitHub(
      "production",
      fullGitHub({ SECRET_VERCEL_TOKEN: "false", VAR_VERCEL_PROJECT_ID: " " }),
    );
    expect(levels(findings, "error").map((item) => item.name)).toEqual(["VERCEL_TOKEN", "VERCEL_PROJECT_ID"]);
  });

  it("warns on an optional group that is missing or partly set, and says why it matters", () => {
    const findings = checkGitHub(
      "production",
      fullGitHub({
        SECRET_SUPABASE_DB_URL: "false",
        VAR_BACKUP_AGE_RECIPIENT: "",
        SECRET_SMTP_PASS: "false",
      }),
    );
    expect(named(findings, "Database backup")[0]).toMatchObject({ level: "warn" });
    expect(named(findings, "Database backup")[0]?.message).toContain("only copy of the database");
    expect(named(findings, "Auth e-mails")[0]?.message).toBe("partly set, missing SMTP_PASS");
    expect(levels(findings, "error")).toEqual([]);
  });

  it("fails when production points at the staging project or reuses its server actions key", () => {
    const findings = checkGitHub(
      "production",
      fullGitHub({ STAGING_PROJECT_REF: PROD_REF, ACTIONS_KEY: "same", STAGING_ACTIONS_KEY: "same" }),
    );
    expect(levels(findings, "error").map((item) => item.name)).toEqual([
      "SUPABASE_PROJECT_REF",
      "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
    ]);
  });

  it("fails on a site URL of the other environment", () => {
    const findings = checkGitHub("staging", fullGitHub());
    expect(levels(findings, "error").map((item) => item.name)).toEqual(["AUTH_SITE_URL", "SMOKE_BASE_URL"]);
  });

  it("never puts a value in its messages", () => {
    const findings = checkGitHub("production", fullGitHub({ STAGING_PROJECT_REF: PROD_REF }));
    expect(JSON.stringify(findings)).not.toContain(PROD_REF);
  });
});

/** Every Vercel variable of a target set, the way the API lists them. */
function fullVercel(target: string, overrides: Record<string, object | null> = {}) {
  const keys = [...VERCEL.required, "ANTHROPIC_API_KEY", "RESEND_API_KEY", ...VERCEL.recommended];
  const variables = keys.map((key) => ({
    key,
    target: [target],
    type: VERCEL.secrets.includes(key) ? "sensitive" : "encrypted",
    value: "encrypted-blob",
  }));
  return variables
    .filter((variable) => overrides[variable.key] !== null)
    .map((variable) => ({ ...variable, ...overrides[variable.key] }));
}

function jwt(claims: object) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part(claims)}.signature`;
}

describe("checkVercel (KRB-157)", () => {
  it("passes when every variable is set on the target, without reading encrypted values", () => {
    const findings = checkVercel("production", fullVercel("production"), PROD_REF);
    expect(levels(findings, "error")).toEqual([]);
    expect(levels(findings, "warn")).toEqual([]);
  });

  it("looks at the target of the environment only: Preview for staging", () => {
    const findings = checkVercel("staging", fullVercel("production"), STAGING_REF);
    expect(named(findings, "APP_ENV")[0]).toMatchObject({ level: "error", message: "missing on preview" });
  });

  it("fails on a missing variable or provider key, and warns on a missing recommended one", () => {
    const findings = checkVercel(
      "production",
      fullVercel("production", { CRON_SECRET: null, ANTHROPIC_API_KEY: null, BILLING_ALERT_EMAIL: null }),
      PROD_REF,
    );
    expect(levels(findings, "error").map((item) => item.name)).toEqual([
      "CRON_SECRET",
      "ANTHROPIC_API_KEY or OPENAI_API_KEY",
    ]);
    expect(levels(findings, "warn").map((item) => item.name)).toEqual(["BILLING_ALERT_EMAIL"]);
  });

  it("fails on FedaPay's mock URL on production, and on a Sensitive public variable", () => {
    const variables = [
      ...fullVercel("production", { NEXT_PUBLIC_APP_URL: { type: "sensitive" } }),
      { key: "FEDAPAY_API_BASE_URL", target: ["production"], type: "encrypted" },
    ];
    const findings = checkVercel("production", variables, PROD_REF);
    expect(levels(findings, "error").map((item) => item.name)).toEqual([
      "FEDAPAY_API_BASE_URL",
      "NEXT_PUBLIC_APP_URL",
    ]);
  });

  it("warns on a secret that is not marked Sensitive", () => {
    const findings = checkVercel(
      "production",
      fullVercel("production", { SUPABASE_SERVICE_ROLE_KEY: { type: "encrypted" } }),
      PROD_REF,
    );
    expect(levels(findings, "warn").map((item) => item.name)).toEqual(["SUPABASE_SERVICE_ROLE_KEY"]);
  });

  it("compares plain values: environment, URLs, FedaPay mode and the Supabase project", () => {
    const plain = (value: string) => ({ type: "plain", value });
    const good = checkVercel(
      "production",
      fullVercel("production", {
        APP_ENV: plain("production"),
        NEXT_PUBLIC_APP_URL: plain("https://kolabreport.com/"),
        FEDAPAY_ENVIRONMENT: plain("live"),
        NEXT_PUBLIC_SUPABASE_URL: plain(`https://${PROD_REF}.supabase.co`),
        NEXT_PUBLIC_SUPABASE_ANON_KEY: plain(jwt({ ref: PROD_REF, role: "anon" })),
      }),
      PROD_REF,
    );
    expect(levels(good, "error")).toEqual([]);

    const staging = checkVercel(
      "production",
      fullVercel("production", {
        APP_ENV: plain("staging"),
        FEDAPAY_ENVIRONMENT: plain("sandbox"),
        NEXT_PUBLIC_SUPABASE_URL: plain(`https://${STAGING_REF}.supabase.co`),
        NEXT_PUBLIC_SUPABASE_ANON_KEY: plain(jwt({ ref: STAGING_REF, role: "anon" })),
      }),
      PROD_REF,
    );
    expect(levels(staging, "error").map((item) => item.name)).toEqual([
      "APP_ENV",
      "FEDAPAY_ENVIRONMENT",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]);
    expect(JSON.stringify(staging)).not.toContain(STAGING_REF);
  });

  it("does not compare a value Vercel returned encrypted", () => {
    const findings = checkVercel(
      "production",
      fullVercel("production", { APP_ENV: { type: "encrypted", value: "staging" } }),
      PROD_REF,
    );
    expect(levels(findings, "error")).toEqual([]);
  });
});

describe("jwtRef", () => {
  it("reads the project of a JWT key and nothing from a publishable key", () => {
    expect(jwtRef(jwt({ ref: PROD_REF }))).toBe(PROD_REF);
    expect(jwtRef("sb_publishable_abc")).toBeNull();
    expect(jwtRef("a.not-base64.c")).toBeNull();
  });
});

describe("report", () => {
  it("says ready only without errors, and lists every finding in the summary", () => {
    const ready = report("production", [
      { level: "ok", where: "GitHub", name: "VERCEL_TOKEN", message: "set" },
      { level: "warn", where: "Vercel", name: "BILLING_ALERT_EMAIL", message: "not set on production" },
    ]);
    expect(ready.ok).toBe(true);
    expect(ready.lines.at(-1)).toBe("Ready to deploy, 1 to look at.");
    expect(ready.markdown).toContain("| ! | Vercel | `BILLING_ALERT_EMAIL` | not set on production |");

    const broken = report("production", [{ level: "error", where: "GitHub", name: "X", message: "missing" }]);
    expect(broken.ok).toBe(false);
    expect(broken.lines.at(-1)).toBe("1 to fix, 0 to look at.");
  });
});

describe("check-settings.yml", () => {
  it("passes every secret and variable the script checks, and no other", async () => {
    const workflow = await readFile(".github/workflows/check-settings.yml", "utf8");
    const passed = (prefix: string) =>
      [...workflow.matchAll(new RegExp(`^\\s+${prefix}_([A-Z0-9_]+):`, "gm"))]
        .map((match) => match[1])
        .sort();
    const secrets = [...GITHUB.secrets, ...GITHUB.groups.flatMap((group) => group.secrets)].sort();
    const variables = [...GITHUB.variables, ...GITHUB.groups.flatMap((group) => group.variables)].sort();
    expect(passed("SECRET")).toEqual(secrets);
    expect(passed("VAR")).toEqual(variables);
  });
});
