import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSender, sendEmail } from "./send";

const email = { to: "a@example.com", subject: "S", html: "<p>H</p>", text: "T" };

describe("parseSender", () => {
  it("reads a name and an address", () => {
    expect(parseSender("KolabReport <noreply@kolab.test>")).toEqual({
      name: "KolabReport",
      email: "noreply@kolab.test",
    });
  });

  it("accepts a bare address and falls back when empty", () => {
    expect(parseSender("hello@kolab.test")).toEqual({ name: "KolabReport", email: "hello@kolab.test" });
    expect(parseSender(undefined).email).toBe("noreply@kolabreport.local");
  });
});

describe("sendEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns false without a provider and says why", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "");
    const warn = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await sendEmail(email)).toBe(false);
    expect(String(warn.mock.calls[0]?.[0])).toContain("EMAIL_PROVIDER is not set");
  });

  it("says which key is missing, and reads the provider in any case", async () => {
    vi.stubEnv("EMAIL_PROVIDER", " Resend ");
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await sendEmail(email)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain("RESEND_API_KEY is not set");
  });

  it("names an unknown provider", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "sendgrid");
    const warn = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await sendEmail(email)).toBe(false);
    const line = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(line.msg).toContain("EMAIL_PROVIDER is not brevo, resend or mailpit");
    expect(line.provider).toBe("sendgrid");
  });

  it("posts to Brevo with the API key", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "brevo");
    vi.stubEnv("BREVO_API_KEY", "key-1");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendEmail(email)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("key-1");
    expect(JSON.parse(String(init.body)).to).toEqual([{ email: "a@example.com" }]);
  });

  it("returns false when the provider fails", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "key-2");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 500 })));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await sendEmail(email)).toBe(false);
  });

  it("logs the provider's reason for a refusal", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "key-3");
    const refusal = { statusCode: 403, name: "validation_error", message: "The domain is not verified." };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(refusal, { status: 403 })));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await sendEmail(email)).toBe(false);
    const logged = String(error.mock.calls[0]?.[0]);
    expect(logged).toContain("403: The domain is not verified.");
    expect(logged).not.toContain("key-3");
  });
});
