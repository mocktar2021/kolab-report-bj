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

  it("returns false without a provider", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "");
    expect(await sendEmail(email)).toBe(false);
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
});
