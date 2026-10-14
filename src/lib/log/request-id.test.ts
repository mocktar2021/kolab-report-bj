// @vitest-environment node
import { describe, expect, it } from "vitest";
import { forwardedRequestId, incomingRequestId } from "./request-id";

const VERCEL_ID = "cdg1::iad1::abcde-1760450000000-0123456789ab";

describe("incomingRequestId", () => {
  it("reuses Vercel's id", () => {
    expect(incomingRequestId(new Headers({ "x-vercel-id": VERCEL_ID }))).toBe(VERCEL_ID);
  });

  it("makes up a UUID when there is none, or when it does not look like an id", () => {
    const uuid = /^[0-9a-f-]{36}$/;
    expect(incomingRequestId(new Headers())).toMatch(uuid);
    expect(incomingRequestId(new Headers({ "x-vercel-id": "<script>" }))).toMatch(uuid);
    expect(incomingRequestId(new Headers({ "x-vercel-id": "a".repeat(129) }))).toMatch(uuid);
  });

  it("never trusts an x-request-id sent by the client", () => {
    expect(incomingRequestId(new Headers({ "x-request-id": "forged" }))).not.toBe("forged");
  });
});

describe("forwardedRequestId", () => {
  it("prefers the middleware's id, then Vercel's, then nothing", () => {
    expect(forwardedRequestId(new Headers({ "x-request-id": "mw-1", "x-vercel-id": VERCEL_ID }))).toBe(
      "mw-1",
    );
    expect(forwardedRequestId(new Headers({ "x-vercel-id": VERCEL_ID }))).toBe(VERCEL_ID);
    expect(forwardedRequestId(new Headers())).toBeNull();
  });
});
