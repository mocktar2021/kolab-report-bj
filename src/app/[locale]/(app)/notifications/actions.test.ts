// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { markNotificationsRead } from "./actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";
const filters: Array<[string, unknown]> = [];

beforeEach(() => {
  filters.length = 0;
  const query = {
    is: (column: string, value: unknown) => (filters.push([column, value]), query),
    in: (column: string, value: unknown) => (filters.push([column, value]), query),
    then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
  };
  vi.mocked(createClient).mockResolvedValue({ from: () => ({ update: () => query }) } as never);
});

/** A list whose items throw when read: only its length may be looked at. */
function untouchable(length: number): string[] {
  return new Proxy(new Array<string>(length).fill("0"), {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) throw new Error("an item was read");
      return Reflect.get(target, key, receiver);
    },
  });
}

describe("markNotificationsRead", () => {
  it("marks the given notifications as read", async () => {
    await expect(markNotificationsRead([ID])).resolves.toEqual({ ok: true });
    expect(filters).toEqual([
      ["read_at", null],
      ["id", [ID]],
    ]);
  });

  // GHSA-mrhx-c7xc-m3w5 (KRB-240): a list over the limit never reaches zod.
  it("refuses a list over 100 ids before validating them", async () => {
    const huge = untouchable(1_000_000);
    await expect(markNotificationsRead(huge)).resolves.toEqual({ ok: false });
    await expect(markNotificationsRead("x" as never)).resolves.toEqual({ ok: false });
    expect(createClient).not.toHaveBeenCalled();
  });
});
