// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BILLING_CRON_STEPS, runCronSteps, type AdminClient, type CronStep } from "./cron";

vi.mock("./notices", () => ({ sendBillingNotices: vi.fn() }));

const admin = {} as AdminClient;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("runCronSteps", () => {
  it("runs the reminders first", () => {
    expect(BILLING_CRON_STEPS.map((step) => step.name)).toEqual(["notices"]);
  });

  it("runs every step in order and keeps their counts", async () => {
    const calls: string[] = [];
    const steps: CronStep[] = [
      { name: "first", run: async () => (calls.push("first"), { ok: true, counts: { a: 1 } }) },
      { name: "second", run: async () => (calls.push("second"), { ok: true, counts: { b: 2 } }) },
    ];

    expect(await runCronSteps(admin, steps)).toEqual({
      ok: true,
      steps: { first: { ok: true, counts: { a: 1 } }, second: { ok: true, counts: { b: 2 } } },
    });
    expect(calls).toEqual(["first", "second"]);
  });

  it("goes on after a step that fails or throws, and fails the run", async () => {
    const last = vi.fn(async () => ({ ok: true, counts: { c: 3 } }));
    const steps: CronStep[] = [
      { name: "failing", run: async () => ({ ok: false, counts: { failed: 1 } }) },
      {
        name: "throwing",
        run: async () => {
          throw new Error("boom");
        },
      },
      { name: "last", run: last },
    ];

    const summary = await runCronSteps(admin, steps);

    expect(summary.ok).toBe(false);
    expect(summary.steps).toEqual({
      failing: { ok: false, counts: { failed: 1 } },
      throwing: { ok: false, counts: {} },
      last: { ok: true, counts: { c: 3 } },
    });
    expect(last).toHaveBeenCalledWith(admin);
  });
});
