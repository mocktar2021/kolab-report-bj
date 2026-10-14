import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubBreadcrumb, scrubEvent, scrubSpan, scrubText, scrubUrl, type StreamedSpan } from "./scrub";

const USER_ID = "4b1f0c2e-7d3a-4f5b-9c8e-1a2b3c4d5e6f";

describe("scrubText", () => {
  it("masks e-mail addresses", () => {
    expect(scrubText("Invitation déjà acceptée par awa.dossou@cabinet-bj.example")).toBe(
      "Invitation déjà acceptée par [email]",
    );
  });

  it("drops query strings and fragments of URLs and paths in a message", () => {
    expect(scrubText("GET https://app.example/fr/auth/callback?code=abc123&next=/fr failed")).toBe(
      "GET https://app.example/fr/auth/callback failed",
    );
    expect(scrubText("redirect to /fr/connexion?next=%2Ffr%2Frapports#top")).toBe(
      "redirect to /fr/connexion",
    );
  });

  it("masks invitation tokens and auth codes", () => {
    expect(scrubText("no invitation at /fr/invitations/Zk3pQ9vX2mL7")).toBe(
      "no invitation at /fr/invitations/[token]",
    );
    expect(scrubText("exchange failed: code=abc123 token_hash=def456")).toBe(
      "exchange failed: code=[Filtered] token_hash=[Filtered]",
    );
  });

  it("masks the model output that AI SDK errors put in their message", () => {
    expect(
      scrubText(
        'Type validation failed: Value: {"sections":[{"title":"Contexte","body":"Le cabinet a audité..."}]}.\nError message: Required',
      ),
    ).toBe("Type validation failed: Value: [Filtered].\nError message: Required");
    expect(scrubText("JSON parsing failed: Text: Voici le brouillon de la section")).toBe(
      "JSON parsing failed: Text: [Filtered]",
    );
  });

  it("cuts very long texts", () => {
    expect(scrubText("x".repeat(5000))).toBe(`${"x".repeat(1000)}[...]`);
  });

  it("leaves ordinary messages alone", () => {
    expect(scrubText("Cannot read properties of undefined (reading 'title')")).toBe(
      "Cannot read properties of undefined (reading 'title')",
    );
  });
});

describe("scrubUrl", () => {
  it("keeps the origin and path only", () => {
    expect(scrubUrl("https://app.example/fr/reinitialiser-mot-de-passe?code=abc#access_token=xyz")).toBe(
      "https://app.example/fr/reinitialiser-mot-de-passe",
    );
    expect(scrubUrl("/fr/invitations/Zk3pQ9vX2mL7?ref=mail")).toBe("/fr/invitations/[token]");
  });
});

function errorEvent(event: Partial<ErrorEvent>): ErrorEvent {
  return { type: undefined, ...event };
}

describe("scrubEvent", () => {
  it("keeps only the user id", () => {
    const event = scrubEvent(
      errorEvent({
        user: { id: USER_ID, email: "awa@cabinet.example", username: "Awa", ip_address: "203.0.113.7" },
      }),
    );
    expect(event.user).toEqual({ id: USER_ID });
  });

  it("drops a user without an id", () => {
    expect(scrubEvent(errorEvent({ user: { ip_address: "203.0.113.7" } })).user).toBeUndefined();
  });

  it("drops cookies, the body, the query string and headers outside the allow-list", () => {
    const event = scrubEvent(
      errorEvent({
        request: {
          url: "https://app.example/fr/invitations/Zk3pQ9vX2mL7?email=awa%40cabinet.example",
          method: "POST",
          data: { content: "Texte de la section" },
          query_string: "email=awa%40cabinet.example",
          cookies: { "sb-access-token": "secret" },
          env: { REMOTE_ADDR: "203.0.113.7" },
          headers: {
            "User-Agent": "Mozilla/5.0",
            "content-type": "text/plain;charset=UTF-8",
            cookie: "sb-access-token=secret",
            referer: "https://app.example/fr/invitations/Zk3pQ9vX2mL7",
            "x-forwarded-for": "203.0.113.7",
          },
        },
      }),
    );
    expect(event.request).toEqual({
      url: "https://app.example/fr/invitations/[token]",
      method: "POST",
      headers: { "User-Agent": "Mozilla/5.0", "content-type": "text/plain;charset=UTF-8" },
    });
  });

  it("drops extra context, so report text and AI prompts never leave with an error", () => {
    const event = scrubEvent(
      errorEvent({ extra: { prompt: "Rédige la section Contexte", section: "Le cabinet a audité..." } }),
    );
    expect(event).not.toHaveProperty("extra");
  });

  it("scrubs messages, exception values and the transaction name", () => {
    const event = scrubEvent(
      errorEvent({
        message: "mail to awa@cabinet.example bounced",
        logentry: { message: "user %s", params: ["awa@cabinet.example"] },
        transaction: "/fr/invitations/Zk3pQ9vX2mL7",
        exception: { values: [{ type: "Error", value: "fetch /fr/auth/callback?code=abc failed" }] },
      }),
    );
    expect(event.message).toBe("mail to [email] bounced");
    expect(event.logentry).toEqual({ message: "user %s", params: ["[email]"] });
    expect(event.transaction).toBe("/fr/invitations/[token]");
    expect(event.exception?.values?.[0]?.value).toBe("fetch /fr/auth/callback failed");
  });

  it("drops local variables and scrubs frame paths and debug images the same way", () => {
    const page = "https://app.example/fr/invitations/Zk3pQ9vX2mL7?x=1";
    const chunk = "https://app.example/_next/static/chunks/app/page-1a2b.js?dpl=dpl_123";
    const event = scrubEvent(
      errorEvent({
        exception: {
          values: [
            {
              type: "TypeError",
              value: "boom",
              stacktrace: {
                frames: [
                  { filename: page, abs_path: page, lineno: 1 },
                  { filename: chunk, abs_path: chunk, lineno: 2, vars: { prompt: "Rédige..." } },
                ],
              },
            },
          ],
        },
        debug_meta: { images: [{ type: "sourcemap", code_file: chunk, debug_id: "d1" }] },
      }),
    );
    const frames = event.exception?.values?.[0]?.stacktrace?.frames;
    expect(frames?.[0]).toEqual({
      filename: "https://app.example/fr/invitations/[token]",
      abs_path: "https://app.example/fr/invitations/[token]",
      lineno: 1,
    });
    expect(frames?.[1]).not.toHaveProperty("vars");
    expect(frames?.[1]?.abs_path).toBe("https://app.example/_next/static/chunks/app/page-1a2b.js");
    expect(event.debug_meta?.images?.[0]?.code_file).toBe(frames?.[1]?.abs_path);
  });

  it("scrubs contexts and tags, and drops headers and cookies found there", () => {
    const event = scrubEvent(
      errorEvent({
        contexts: {
          nextjs: { request_path: "/fr/invitations/Zk3pQ9vX2mL7?ref=mail", route_type: "render" },
          response: { status_code: 500, headers: { "set-cookie": "sb=secret" } },
        },
        tags: { page: "/fr/connexion?next=/fr/rapports", retries: 2 },
      }),
    );
    expect(event.contexts).toEqual({
      nextjs: { request_path: "/fr/invitations/[token]", route_type: "render" },
      response: { status_code: 500 },
    });
    expect(event.tags).toEqual({ page: "/fr/connexion", retries: 2 });
  });

  it("scrubs the breadcrumbs it carries", () => {
    const event = scrubEvent(
      errorEvent({ breadcrumbs: [{ category: "console", message: "sent to awa@cabinet.example" }] }),
    );
    expect(event.breadcrumbs).toEqual([{ category: "console", message: "sent to [email]" }]);
  });
});

describe("scrubBreadcrumb", () => {
  it("strips query strings from fetch and navigation URLs", () => {
    expect(
      scrubBreadcrumb({
        category: "fetch",
        data: {
          method: "GET",
          url: "https://ref.supabase.co/rest/v1/profiles?select=full_name,email&email=eq.awa@cabinet.example",
          "http.query": "?select=full_name,email",
          status_code: 200,
        },
      }),
    ).toEqual({
      category: "fetch",
      data: { method: "GET", url: "https://ref.supabase.co/rest/v1/profiles", status_code: 200 },
    });
    expect(
      scrubBreadcrumb({
        category: "navigation",
        data: { from: "/fr/invitations/Zk3pQ9vX2mL7", to: "/fr/auth/callback?code=abc" },
      }).data,
    ).toEqual({ from: "/fr/invitations/[token]", to: "/fr/auth/callback" });
  });

  it("drops console arguments and objects, and scrubs the message", () => {
    expect(
      scrubBreadcrumb({
        category: "console",
        level: "error",
        message: "sendEmail failed for awa@cabinet.example",
        data: { arguments: ["sendEmail failed", { to: "awa@cabinet.example" }], logger: "console" },
      }),
    ).toEqual({
      category: "console",
      level: "error",
      message: "sendEmail failed for [email]",
      data: { logger: "console" },
    });
  });

  it("removes attribute selectors from click breadcrumbs", () => {
    expect(
      scrubBreadcrumb({
        category: "ui.click",
        message: 'main > a.card[aria-label="Rapport Audit SONEB 2026"]',
      }).message,
    ).toBe("main > a.card");
  });
});

describe("scrubSpan", () => {
  it("scrubs the name and URL attributes, and keeps user.id only", () => {
    const span: StreamedSpan = {
      trace_id: "a".repeat(32),
      span_id: "b".repeat(16),
      name: "/fr/invitations/Zk3pQ9vX2mL7",
      start_timestamp: 1,
      end_timestamp: 2,
      status: "ok",
      is_segment: true,
      attributes: {
        "sentry.op": "pageload",
        "url.full": "https://app.example/fr/invitations/Zk3pQ9vX2mL7?ref=mail",
        "url.query": "ref=mail",
        "user.id": USER_ID,
        "user.email": "awa@cabinet.example",
        "user.ip_address": "203.0.113.7",
        "client.address": "203.0.113.7",
        "browser.web_vital.lcp.value": 1200,
      },
    };
    const scrubbed = scrubSpan(span);
    expect(scrubbed.name).toBe("/fr/invitations/[token]");
    expect(scrubbed.attributes).toEqual({
      "sentry.op": "pageload",
      "url.full": "https://app.example/fr/invitations/[token]",
      "user.id": USER_ID,
      "browser.web_vital.lcp.value": 1200,
    });
  });
});
