// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRequestId, log, withRequestId } from "./index";

// What next/headers returns for the request being rendered. Null: outside a
// request, where the real headers() throws.
const incoming = vi.hoisted(() => ({ headers: null as Headers | null }));

vi.mock("next/headers", () => ({
  headers: async () => {
    if (!incoming.headers) throw new Error("`headers` was called outside a request scope");
    return incoming.headers;
  },
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERCEL_ID = "cdg1::iad1::abcde-1760450000000-0123456789ab";

beforeEach(() => {
  incoming.headers = null;
});

describe("getRequestId in pages and server actions", () => {
  it("is null outside a request", async () => {
    expect(await getRequestId()).toBeNull();
  });

  it("reads the id the middleware passed, else Vercel's", async () => {
    incoming.headers = new Headers({ "x-request-id": "mw-1", "x-vercel-id": VERCEL_ID });
    expect(await getRequestId()).toBe("mw-1");

    incoming.headers = new Headers({ "x-vercel-id": VERCEL_ID });
    expect(await getRequestId()).toBe(VERCEL_ID);
  });

  it("ignores a header that does not look like an id", async () => {
    incoming.headers = new Headers({ "x-request-id": 'a b"}', "x-vercel-id": "x".repeat(129) });
    expect(await getRequestId()).toBeNull();
  });

  it("puts the id on every log line", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    incoming.headers = new Headers({ "x-request-id": "mw-2" });

    log.info("prompts: could not save a version");
    await vi.waitFor(() => expect(stdout).toHaveBeenCalledOnce());

    expect(JSON.parse(String(stdout.mock.calls[0]?.[0])).requestId).toBe("mw-2");
  });
});

describe("withRequestId in route handlers", () => {
  it("uses x-vercel-id and sends it back in x-request-id", async () => {
    const handler = withRequestId(async () => Response.json({ id: await getRequestId() }));

    const response = await handler(
      new Request("http://localhost/api/x", { headers: { "x-vercel-id": VERCEL_ID } }),
    );

    expect(await response.json()).toEqual({ id: VERCEL_ID });
    expect(response.headers.get("x-request-id")).toBe(VERCEL_ID);
  });

  it("makes up one id per request otherwise, and ignores an x-request-id from the client", async () => {
    const handler = withRequestId(async () => Response.json({ id: await getRequestId() }));
    const call = () =>
      handler(new Request("http://localhost/api/x", { headers: { "x-request-id": "forged" } }));

    const [first, second] = await Promise.all([call(), call()]);
    const firstId = (await first.json()).id;

    expect(firstId).toMatch(UUID);
    expect(first.headers.get("x-request-id")).toBe(firstId);
    expect((await second.json()).id).not.toBe(firstId);
  });

  it("keeps the id for work that goes on after the answer", async () => {
    let later: Promise<string | null> = Promise.resolve(null);
    const handler = withRequestId(async () => {
      later = new Promise((resolve) => setTimeout(resolve, 5)).then(() => getRequestId());
      return new Response("ok");
    });

    const response = await handler(new Request("http://localhost/api/x"));

    expect(await later).toBe(response.headers.get("x-request-id"));
  });

  it("puts the id on log lines without waiting", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = withRequestId(async () => {
      log.error("exports: could not build the file", { error: new Error("boom") });
      return new Response("ok");
    });

    void handler(new Request("http://localhost/api/x", { headers: { "x-vercel-id": VERCEL_ID } }));

    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toMatchObject({
      level: "error",
      requestId: VERCEL_ID,
    });
  });

  it("returns a response with read-only headers as it is", async () => {
    const handler = withRequestId(async () => Response.redirect("https://storage.test/file", 303));
    const response = await handler(new Request("http://localhost/api/x"));
    expect(response.status).toBe(303);
  });
});
