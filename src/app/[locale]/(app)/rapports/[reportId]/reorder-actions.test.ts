// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { reorderSections } from "./actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/workspaces/server", () => ({ requireWorkspaceRole: vi.fn() }));

const REPORT_ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";
const SECTION_ID = "1c7cab58-1d5f-4b6a-8b54-7f1b3e2d4f22";
const rpc = vi.fn();

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ error: null });
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
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

describe("reorderSections", () => {
  it("saves a valid order", async () => {
    await expect(reorderSections(REPORT_ID, [SECTION_ID])).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("reorder_report_sections", {
      p_report_id: REPORT_ID,
      p_section_ids: [SECTION_ID],
    });
  });

  // GHSA-mrhx-c7xc-m3w5 (KRB-240): a list over the limit never reaches zod.
  it("refuses a list over 500 items before validating them", async () => {
    const huge = untouchable(1_000_000);
    await expect(reorderSections(REPORT_ID, huge)).resolves.toEqual({ ok: false, error: "invalidInput" });
    await expect(reorderSections(REPORT_ID, "x" as never)).resolves.toEqual({
      ok: false,
      error: "invalidInput",
    });
    expect(createClient).not.toHaveBeenCalled();
  });
});
