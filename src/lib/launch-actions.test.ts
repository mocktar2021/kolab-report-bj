// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestLaunchReminder } from "./launch-actions";
import { saveLaunchReminder } from "./launch-reminder";

vi.mock("./launch-reminder", () => ({ saveLaunchReminder: vi.fn() }));

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const idle = { status: "idle" } as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T10:00:00.000Z"));
  vi.stubEnv("APP_ENV", "production");
  vi.mocked(saveLaunchReminder).mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("requestLaunchReminder", () => {
  it("keeps a valid address, trimmed and in lower case", async () => {
    await expect(requestLaunchReminder(idle, form({ email: "  Aicha@Kolab.test " }))).resolves.toEqual({
      status: "done",
    });
    expect(saveLaunchReminder).toHaveBeenCalledWith("aicha@kolab.test");
  });

  it("thanks a bot that fills the hidden field and keeps nothing", async () => {
    const state = await requestLaunchReminder(
      idle,
      form({ email: "bot@spam.test", website: "https://spam.test" }),
    );
    expect(state).toEqual({ status: "done" });
    expect(saveLaunchReminder).not.toHaveBeenCalled();
  });

  it("returns an invalid address with the error", async () => {
    const state = await requestLaunchReminder(idle, form({ email: "aicha@" }));
    expect(state).toEqual({ status: "error", error: "emailInvalid", email: "aicha@" });
    expect(saveLaunchReminder).not.toHaveBeenCalled();
  });

  it("says so when Resend refuses", async () => {
    vi.mocked(saveLaunchReminder).mockResolvedValue(false);
    const state = await requestLaunchReminder(idle, form({ email: "aicha@kolab.test" }));
    expect(state).toEqual({ status: "error", error: "unavailable", email: "aicha@kolab.test" });
  });

  it("keeps nothing after the launch or outside production", async () => {
    vi.setSystemTime(new Date("2026-10-27T08:00:00.000Z"));
    const after = await requestLaunchReminder(idle, form({ email: "aicha@kolab.test" }));
    expect(after).toMatchObject({ status: "error", error: "unavailable" });

    vi.setSystemTime(new Date("2026-10-24T10:00:00.000Z"));
    vi.stubEnv("APP_ENV", "staging");
    const staging = await requestLaunchReminder(idle, form({ email: "aicha@kolab.test" }));
    expect(staging).toMatchObject({ status: "error", error: "unavailable" });

    expect(saveLaunchReminder).not.toHaveBeenCalled();
  });
});
