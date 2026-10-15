// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { getBillingSettings, readBillingSettings } from "./settings";

const SANDBOX = {
  FEDAPAY_ENVIRONMENT: "sandbox",
  FEDAPAY_SECRET_KEY: "sk_sandbox_test_key",
  FEDAPAY_WEBHOOK_SECRET: "wh_sandbox_test_secret",
};

const LIVE = {
  APP_ENV: "production",
  FEDAPAY_ENVIRONMENT: "live",
  FEDAPAY_SECRET_KEY: "sk_live_test_key",
  FEDAPAY_WEBHOOK_SECRET: "wh_live_test_secret",
};

const MOCK = {
  FEDAPAY_ENVIRONMENT: "mock",
  FEDAPAY_API_BASE_URL: "http://127.0.0.1:4010",
  FEDAPAY_SECRET_KEY: "sk_mock_key",
  FEDAPAY_WEBHOOK_SECRET: "wh_mock_secret",
};

describe("readBillingSettings", () => {
  it("uses the sandbox API on a preview", () => {
    const settings = readBillingSettings({ ...SANDBOX, VERCEL_ENV: "preview" });
    expect(settings.problems).toEqual([]);
    expect(settings.production).toBe(false);
    expect(settings.api).toEqual({
      environment: "sandbox",
      apiBaseUrl: "https://sandbox-api.fedapay.com",
      secretKey: "sk_sandbox_test_key",
    });
    expect(settings.webhook).toEqual({ secret: "wh_sandbox_test_secret", api: settings.api });
  });

  it("uses the live API in production, by APP_ENV or by VERCEL_ENV", () => {
    for (const env of [LIVE, { ...LIVE, APP_ENV: undefined, VERCEL_ENV: "production" }]) {
      const settings = readBillingSettings(env);
      expect(settings.problems).toEqual([]);
      expect(settings.production).toBe(true);
      expect(settings.api?.apiBaseUrl).toBe("https://api.fedapay.com");
      expect(settings.webhook?.secret).toBe("wh_live_test_secret");
    }
  });

  it("uses the mock on a loopback address, by default port 4010", () => {
    expect(readBillingSettings(MOCK).api?.apiBaseUrl).toBe("http://127.0.0.1:4010");
    const withoutUrl = { ...MOCK, FEDAPAY_API_BASE_URL: undefined };
    expect(readBillingSettings(withoutUrl).api?.apiBaseUrl).toBe("http://127.0.0.1:4010");
    const localhost = readBillingSettings({ ...MOCK, FEDAPAY_API_BASE_URL: "http://localhost:4999/" });
    expect(localhost.api?.apiBaseUrl).toBe("http://localhost:4999");
  });

  it("turns everything off without FEDAPAY_ENVIRONMENT, or with an unknown one", () => {
    expect(readBillingSettings({})).toMatchObject({
      environment: null,
      api: null,
      webhook: null,
      problems: ["environment_missing"],
    });
    expect(readBillingSettings({ ...SANDBOX, FEDAPAY_ENVIRONMENT: "test" })).toMatchObject({
      environment: null,
      api: null,
      problems: ["environment_invalid"],
    });
  });

  it("refuses live outside production, so a preview never takes real money", () => {
    for (const env of [
      { ...LIVE, APP_ENV: "staging" },
      { ...LIVE, APP_ENV: undefined, VERCEL_ENV: "preview" },
      { ...LIVE, APP_ENV: undefined },
    ]) {
      expect(readBillingSettings(env)).toMatchObject({
        environment: "live",
        api: null,
        webhook: null,
        problems: ["live_outside_production"],
      });
    }
  });

  it("refuses sandbox and mock in production", () => {
    expect(readBillingSettings({ ...SANDBOX, APP_ENV: "production" })).toMatchObject({
      api: null,
      webhook: null,
      problems: ["not_live_in_production"],
    });
    expect(readBillingSettings({ ...MOCK, VERCEL_ENV: "production" })).toMatchObject({
      api: null,
      problems: ["not_live_in_production"],
    });
  });

  it("refuses any base URL override in production, even the live one", () => {
    for (const url of ["http://127.0.0.1:4010", "https://api.fedapay.com", "https://example.com"]) {
      expect(readBillingSettings({ ...LIVE, FEDAPAY_API_BASE_URL: url })).toMatchObject({
        api: null,
        webhook: null,
        problems: ["base_url_in_production"],
      });
    }
  });

  it("accepts only a loopback override, or the environment's own origin, elsewhere", () => {
    const own = readBillingSettings({ ...SANDBOX, FEDAPAY_API_BASE_URL: "https://sandbox-api.fedapay.com/" });
    expect(own.api?.apiBaseUrl).toBe("https://sandbox-api.fedapay.com");
    expect(
      readBillingSettings({ ...SANDBOX, FEDAPAY_API_BASE_URL: "http://[::1]:4010" }).api?.apiBaseUrl,
    ).toBe("http://[::1]:4010");

    for (const url of ["https://api.fedapay.com", "https://fedapay.example.com", "http://10.0.0.5:4010"]) {
      expect(readBillingSettings({ ...SANDBOX, FEDAPAY_API_BASE_URL: url })).toMatchObject({
        api: null,
        problems: ["base_url_not_allowed"],
      });
    }
    expect(
      readBillingSettings({ ...MOCK, FEDAPAY_API_BASE_URL: "https://sandbox-api.fedapay.com" }),
    ).toMatchObject({ api: null, problems: ["base_url_not_allowed"] });
  });

  it("refuses an override that is not a bare http or https origin", () => {
    for (const url of [
      "not a url",
      "ftp://127.0.0.1",
      "http://127.0.0.1:4010/v1",
      "http://127.0.0.1:4010?x=1",
      "http://user:pass@127.0.0.1:4010",
    ]) {
      expect(readBillingSettings({ ...MOCK, FEDAPAY_API_BASE_URL: url })).toMatchObject({
        api: null,
        problems: ["base_url_invalid"],
      });
    }
  });

  it("turns checkout off without a secret key, and treats the .env.example placeholder as missing", () => {
    for (const key of [undefined, "", "  ", "your-fedapay-secret-key"]) {
      const settings = readBillingSettings({ ...SANDBOX, FEDAPAY_SECRET_KEY: key });
      expect(settings.environment).toBe("sandbox");
      expect(settings.api).toBeNull();
      expect(settings.webhook).toBeNull();
      expect(settings.problems).toEqual(["secret_key_missing"]);
    }
  });

  it("keeps checkout on without a webhook secret, but not the webhook", () => {
    const settings = readBillingSettings({ ...SANDBOX, FEDAPAY_WEBHOOK_SECRET: "" });
    expect(settings.api?.environment).toBe("sandbox");
    expect(settings.webhook).toBeNull();
    expect(settings.problems).toEqual(["webhook_secret_missing"]);
  });

  it("turns everything off when a key or webhook secret shows the other mode", () => {
    expect(readBillingSettings({ ...SANDBOX, FEDAPAY_WEBHOOK_SECRET: "wh_live_abc" })).toMatchObject({
      api: null,
      webhook: null,
      problems: ["webhook_secret_wrong_mode"],
    });
    expect(readBillingSettings({ ...LIVE, FEDAPAY_SECRET_KEY: "sk_sandbox_abc" })).toMatchObject({
      api: null,
      problems: ["secret_key_wrong_mode"],
    });
    expect(readBillingSettings({ ...MOCK, FEDAPAY_SECRET_KEY: "sk_live_abc" })).toMatchObject({
      api: null,
      problems: ["secret_key_wrong_mode"],
    });
    // A sandbox key against the mock is fine, and so is a key with no prefix.
    expect(readBillingSettings({ ...MOCK, FEDAPAY_SECRET_KEY: "sk_sandbox_abc" }).problems).toEqual([]);
    expect(readBillingSettings({ ...LIVE, FEDAPAY_WEBHOOK_SECRET: "plainsecret" }).problems).toEqual([]);
  });

  it("reads the environment in any case and trims values", () => {
    const settings = readBillingSettings({
      ...SANDBOX,
      FEDAPAY_ENVIRONMENT: " Sandbox ",
      FEDAPAY_SECRET_KEY: " k ",
    });
    expect(settings.api?.secretKey).toBe("k");
  });

  it("keeps the alert e-mail only when it is one", () => {
    expect(readBillingSettings({ BILLING_ALERT_EMAIL: " ops@kolabreport.test " }).alertEmail).toBe(
      "ops@kolabreport.test",
    );
    expect(readBillingSettings({ BILLING_ALERT_EMAIL: "ops" }).alertEmail).toBeNull();
    expect(readBillingSettings({}).alertEmail).toBeNull();
  });
});

// The logger writes once it knows the request id, a few ticks later.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("getBillingSettings", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("logs the broken rules once, as an error in production, without any key", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("FEDAPAY_ENVIRONMENT", "sandbox");
    vi.stubEnv("FEDAPAY_SECRET_KEY", "sk_sandbox_do_not_log");
    vi.stubEnv("FEDAPAY_WEBHOOK_SECRET", "wh_sandbox_do_not_log");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getBillingSettings().api).toBeNull();
    expect(getBillingSettings().api).toBeNull();
    await flush();

    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      msg: "billing: misconfigured",
      environment: "sandbox",
      production: true,
      problems: ["not_live_in_production"],
    });
    expect(line).not.toContain("do_not_log");
  });

  it("warns outside production and stays quiet when all is well", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("FEDAPAY_ENVIRONMENT", "mock");
    vi.stubEnv("FEDAPAY_API_BASE_URL", "");
    vi.stubEnv("FEDAPAY_SECRET_KEY", "sk_mock_key");
    vi.stubEnv("FEDAPAY_WEBHOOK_SECRET", "");
    const warn = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(getBillingSettings().webhook).toBeNull();
    await flush();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      level: "warn",
      msg: "billing: misconfigured",
      problems: ["webhook_secret_missing"],
    });

    vi.stubEnv("FEDAPAY_WEBHOOK_SECRET", "wh_mock_secret");
    warn.mockClear();
    expect(getBillingSettings().webhook).not.toBeNull();
    await flush();
    expect(warn).not.toHaveBeenCalled();
  });
});
