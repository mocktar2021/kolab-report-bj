// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { checkDailyCost, startGeneration, type StartRequest } from "./generation-store";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));

const rpc = vi.fn();
const alert = { dailyUsd: 10, email: "ops@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>);
  rpc.mockImplementation(async (name: string) =>
    name === "claim_ai_daily_cost_alert" ? { data: 12.5, error: null } : { data: null, error: null },
  );
});

describe("startGeneration", () => {
  const request: StartRequest = {
    workspaceId: "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11",
    sectionId: "1c7cab58-1d5f-4b6a-8b54-7f1b3e2d4f22",
    userId: "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a",
    promptVersionId: "4d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a",
    rolloutId: null,
    outputSchema: "section_draft",
    provider: "mock",
    model: "mock",
    params: { temperature: 0.3, maxOutputTokens: 1024, modelTier: "standard" },
    estimatedTokens: 1000,
    rateLimitPerHour: 30,
    monthlyTokenBudget: 2_000_000,
  };

  function answer(row: { generation_id: string | null; refusal: string | null; retry_after: number | null }) {
    rpc.mockImplementation(() => ({ maybeSingle: async () => ({ data: row, error: null }) }));
  }

  it("passes on the refusals of the organization's plan", async () => {
    answer({ generation_id: null, refusal: "quotaExceeded", retry_after: 3600 });
    expect(await startGeneration(request)).toEqual({ ok: false, refusal: "quotaExceeded", retryAfter: 3600 });
    answer({ generation_id: null, refusal: "quotaExceeded", retry_after: null });
    expect(await startGeneration(request)).toEqual({ ok: false, refusal: "quotaExceeded", retryAfter: null });
    for (const refusal of ["readOnly", "templateNotIncluded"]) {
      answer({ generation_id: null, refusal, retry_after: null });
      expect(await startGeneration(request)).toEqual({ ok: false, refusal, retryAfter: null });
    }
  });

  it("turns an unknown refusal into a generic one", async () => {
    answer({ generation_id: null, refusal: "somethingNew", retry_after: null });
    expect(await startGeneration(request)).toEqual({ ok: false, refusal: "generic", retryAfter: null });
  });
});

describe("checkDailyCost", () => {
  it("does nothing without an alert setting", async () => {
    await checkDailyCost(null);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends nothing while the day is under the threshold or already claimed", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await checkDailyCost(alert);
    expect(rpc).toHaveBeenCalledWith("claim_ai_daily_cost_alert", { p_threshold: 10 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends one e-mail with the amount and keeps the day claimed", async () => {
    vi.mocked(sendEmail).mockResolvedValue(true);
    await checkDailyCost(alert);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ops@example.com", subject: expect.stringContaining("12.50 USD") }),
    );
    expect(rpc).not.toHaveBeenCalledWith("release_ai_cost_alert");
  });

  it("gives the day back when the e-mail fails, so the next generation tries again", async () => {
    vi.mocked(sendEmail).mockResolvedValue(false);
    await checkDailyCost(alert);
    expect(rpc).toHaveBeenLastCalledWith("release_ai_cost_alert");
  });
});
