// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/env", () => ({
  publicEnv: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" },
}));

const abortSignal = vi.fn();

function database(answer: () => Promise<{ data: unknown; error: { message: string } | null }>) {
  abortSignal.mockImplementation(answer);
  vi.mocked(createClient).mockReturnValue({
    rpc: vi.fn(() => ({ abortSignal })),
  } as unknown as ReturnType<typeof createClient>);
}

const call = () => GET(new Request("http://localhost/api/health"));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.unstubAllEnvs();
});

describe("GET /api/health", () => {
  it("answers 200 when the database answers true, with the short commit", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");
    database(async () => ({ data: true, error: null }));

    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    const body = await response.json();
    expect(body).toEqual({ status: "ok", checks: { database: "ok" }, release: "0123456", time: body.time });
    expect(Date.parse(body.time)).not.toBeNaN();
  });

  it("gives the database 3 seconds", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    database(async () => ({ data: true, error: null }));

    await call();

    expect(timeout).toHaveBeenCalledWith(3000);
    expect(abortSignal).toHaveBeenCalledWith(timeout.mock.results[0]?.value);
  });

  it("answers 503 without the error when the database fails, times out or throws", async () => {
    const answers = [
      async () => ({
        data: null,
        error: { message: "AbortError: The operation was aborted due to timeout" },
      }),
      async () => ({ data: null, error: { message: 'relation "x" does not exist' } }),
      async () => {
        throw new Error("fetch failed: connect ECONNREFUSED 10.0.0.1:5432");
      },
    ];
    for (const answer of answers) {
      database(answer);
      const response = await call();
      const text = await response.text();

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.parse(text)).toMatchObject({
        status: "error",
        checks: { database: "error" },
        release: null,
      });
      expect(text).not.toMatch(/abort|relation|ECONNREFUSED|10\.0\.0\.1/i);
    }
    // The reason goes to the logs instead.
    expect(console.error).toHaveBeenCalledTimes(3);
  });

  it("never echoes a release value that is not a commit", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "secret-value");
    database(async () => ({ data: true, error: null }));
    expect((await (await call()).json()).release).toBeNull();
  });
});
