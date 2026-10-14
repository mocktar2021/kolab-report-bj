// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createLogger, formatLogLine, maskEmails, redact } from "./format";

const TIME = "2026-10-14T16:00:00.000Z";

describe("redact", () => {
  it("hides secrets, e-mails and report text, whatever the case or the prefix", () => {
    expect(
      redact({
        email: "a@kolab.test",
        userEmail: "b@kolab.test",
        password: "Kolab-2026",
        accessToken: "eyJhbGciOi",
        refresh_token: "r-1",
        clientSecret: "s-1",
        Authorization: "Bearer x",
        cookie: "sb-access-token=x",
        apiKey: "k-1",
        content: "Texte de la section",
        parsed_content: "Contenu du livrable",
        prompt: "Rédige la section",
        systemPrompt: "Tu es un expert",
        output: { title: "Brouillon" },
        rawOutput: "{}",
        markdown: "# Rapport",
      }),
    ).toEqual({
      email: "[redacted]",
      userEmail: "[redacted]",
      password: "[redacted]",
      accessToken: "[redacted]",
      refresh_token: "[redacted]",
      clientSecret: "[redacted]",
      Authorization: "[redacted]",
      cookie: "[redacted]",
      apiKey: "[redacted]",
      content: "[redacted]",
      parsed_content: "[redacted]",
      prompt: "[redacted]",
      systemPrompt: "[redacted]",
      output: "[redacted]",
      rawOutput: "[redacted]",
      markdown: "[redacted]",
    });
  });

  it("keeps ids, counts and flags, nested ones included", () => {
    expect(
      redact({
        generationId: "g-1",
        bucket: "exports",
        failed: 2,
        decisions: [{ ref: "L1", action: "cut", fromTokens: 900, toTokens: 400 }],
        usage: { inputTokens: 1200, outputTokens: 300, hasContent: true },
      }),
    ).toEqual({
      generationId: "g-1",
      bucket: "exports",
      failed: 2,
      decisions: [{ ref: "L1", action: "cut", fromTokens: 900, toTokens: 400 }],
      usage: { inputTokens: 1200, outputTokens: 300, hasContent: true },
    });
  });

  it("hides sensitive keys at any depth", () => {
    expect(
      redact({ user: { id: "u-1", email: "a@kolab.test" }, files: [{ name: "a", content: "x" }] }),
    ).toEqual({
      user: { id: "u-1", email: "[redacted]" },
      files: [{ name: "a", content: "[redacted]" }],
    });
  });

  it("logs an error as its name, message and stack, with e-mails masked", () => {
    const error = new TypeError("no profile for jean.dupont@cabinet.test");
    Object.assign(error, { requestBodyValues: { prompt: "Rédige la section" } });

    const { error: logged } = redact({ error }) as { error: Record<string, unknown> };

    expect(Object.keys(logged)).toEqual(["name", "message", "stack"]);
    expect(logged.name).toBe("TypeError");
    expect(logged.message).toBe("no profile for [email]");
    expect(logged.stack).toContain("TypeError: no profile for [email]");
    expect(logged.stack).not.toContain("cabinet.test");
  });

  it("follows the cause of an error", () => {
    const error = new Error("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:54321") });
    const { error: logged } = redact({ error }) as { error: { cause: { message: string } } };
    expect(logged.cause.message).toBe("connect ECONNREFUSED 127.0.0.1:54321");
  });

  it("masks e-mails in any text and copes with odd values", () => {
    const loop: Record<string, unknown> = { id: "a" };
    loop.self = loop;
    expect(
      redact({
        note: "sent to a@kolab.test and b.c+d@sub.kolab.test",
        at: new Date(TIME),
        size: 10n,
        bytes: new Uint8Array(4),
        run: () => 1,
        loop,
      }),
    ).toEqual({
      note: "sent to [email] and [email]",
      at: TIME,
      size: "10",
      bytes: "[4 bytes]",
      run: undefined,
      loop: { id: "a", self: "[circular]" },
    });
  });

  it("does not change the fields it is given", () => {
    const fields = { email: "a@kolab.test" };
    redact(fields);
    expect(fields.email).toBe("a@kolab.test");
  });
});

describe("maskEmails", () => {
  it("leaves text without an address alone", () => {
    expect(maskEmails("exports: could not store the file")).toBe("exports: could not store the file");
  });
});

describe("formatLogLine", () => {
  it("writes one JSON object on one line, level, msg, time and requestId first", () => {
    const line = formatLogLine(
      "error",
      "exports: could not store the file",
      { error: new Error("first\nsecond"), exportId: "e-1" },
      { time: TIME, requestId: "cdg1::abc-123" },
    );

    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line);
    expect(Object.keys(parsed)).toEqual(["level", "msg", "time", "requestId", "error", "exportId"]);
    expect(parsed).toMatchObject({
      level: "error",
      msg: "exports: could not store the file",
      time: TIME,
      requestId: "cdg1::abc-123",
      exportId: "e-1",
    });
  });

  it("keeps requestId null without a request, and fields cannot override the line keys", () => {
    const parsed = JSON.parse(
      formatLogLine("info", "m", { level: "error", msg: "x", time: "y", requestId: "z" }, { time: TIME }),
    );
    expect(parsed).toEqual({ level: "info", msg: "m", time: TIME, requestId: null });
  });
});

describe("createLogger", () => {
  it("writes info and warn to stdout, error to stderr", () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = createLogger(() => "req-1");

    log.info("a");
    log.warn("b", { count: 1 });
    log.error("c", { error: new Error("boom") });

    expect(stdout.mock.calls.map(([line]) => JSON.parse(String(line)))).toMatchObject([
      { level: "info", msg: "a", requestId: "req-1" },
      { level: "warn", msg: "b", requestId: "req-1", count: 1 },
    ]);
    expect(stderr).toHaveBeenCalledOnce();
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toMatchObject({
      level: "error",
      msg: "c",
      requestId: "req-1",
      error: { name: "Error", message: "boom" },
    });
  });

  it("waits for an id that comes later, and cleans the fields at the time of the call", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let resolve: (id: string) => void = () => undefined;
    const log = createLogger(() => new Promise<string>((done) => (resolve = done)));
    const fields = { step: "before" };

    log.info("later", fields);
    fields.step = "after";
    expect(stdout).not.toHaveBeenCalled();
    resolve("req-2");
    await vi.waitFor(() => expect(stdout).toHaveBeenCalledOnce());

    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({
      requestId: "req-2",
      step: "before",
    });
  });

  it("never throws, and writes the line without an id when the id fails", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const failing = createLogger(() => {
      throw new Error("no request");
    });
    const rejecting = createLogger(() => Promise.reject(new Error("no request")));

    expect(() => failing.info("sync")).not.toThrow();
    rejecting.info("async");
    await vi.waitFor(() => expect(stdout).toHaveBeenCalledTimes(2));

    expect(stdout.mock.calls.map(([line]) => JSON.parse(String(line)).requestId)).toEqual([null, null]);
  });
});
