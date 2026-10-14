// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { checkDailyCost } from "./generation-store";

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
    name === "claim_ai_cost_alert" ? { data: 12.5, error: null } : { data: null, error: null },
  );
});

describe("checkDailyCost", () => {
  it("does nothing without an alert setting", async () => {
    await checkDailyCost(null);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends nothing while the day is under the threshold or already claimed", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await checkDailyCost(alert);
    expect(rpc).toHaveBeenCalledWith("claim_ai_cost_alert", { p_threshold: 10 });
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
