// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { GET } from "./route";

vi.mock("@/lib/log", () => ({
  withRequestId: (handler: (...args: unknown[]) => Promise<Response>) => handler,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/user", () => ({ getCurrentUser: vi.fn() }));

const USER = { id: "0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d" };
const EXPIRES_AT = 1_792_000_000;

function sessionIs(session: unknown) {
  const getSession = vi.fn(async () => ({ data: { session }, error: null }));
  vi.mocked(createClient).mockResolvedValue({ auth: { getSession } } as unknown as Awaited<
    ReturnType<typeof createClient>
  >);
  return getSession;
}

function get() {
  return GET(new Request("http://localhost:3000/api/realtime/token"));
}

describe("GET /api/realtime/token", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(createClient).mockReset();
  });

  it("returns the access token of the signed-in user and its expiry in milliseconds", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER as Awaited<ReturnType<typeof getCurrentUser>>);
    sessionIs({ access_token: "user-jwt", expires_at: EXPIRES_AT });

    const response = await get();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ token: "user-jwt", expiresAt: EXPIRES_AT * 1000 });
  });

  it("checks the user with Supabase Auth before reading the session", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const getSession = sessionIs({ access_token: "user-jwt", expires_at: EXPIRES_AT });

    const response = await get();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("answers 401 when the session has gone since the check", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER as Awaited<ReturnType<typeof getCurrentUser>>);
    sessionIs(null);

    const response = await get();

    expect(response.status).toBe(401);
  });
});
