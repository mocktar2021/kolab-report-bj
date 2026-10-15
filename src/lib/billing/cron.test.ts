// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BILLING_CRON_STEPS, RECONCILE_LIMIT, runCronSteps, type AdminClient, type CronStep } from "./cron";
import { reconcilePendingPurchases } from "./reconcile";
import { applyDeps, stuckAlert } from "./server";
import { getBillingSettings, type BillingSettings } from "./settings";

vi.mock("./notices", () => ({ sendBillingNotices: vi.fn() }));
vi.mock("./reconcile", () => ({ reconcilePendingPurchases: vi.fn() }));
vi.mock("./server", () => ({ applyDeps: vi.fn(), stuckAlert: vi.fn() }));
vi.mock("./settings", () => ({ getBillingSettings: vi.fn() }));

const admin = {} as AdminClient;

const API = {
  environment: "sandbox",
  apiBaseUrl: "https://sandbox-api.fedapay.com",
  secretKey: "sk_sandbox_x",
} as const;

function settings(overrides: Partial<BillingSettings> = {}): BillingSettings {
  return {
    production: false,
    environment: "sandbox",
    api: API,
    webhook: null,
    alertEmail: null,
    problems: [],
    ...overrides,
  };
}

function reconcileStep() {
  const step = BILLING_CRON_STEPS.find((candidate) => candidate.name === "reconcile");
  if (!step) throw new Error("No reconcile step");
  return step;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("BILLING_CRON_STEPS", () => {
  it("sends the reminders, then reconciles pending payments", () => {
    expect(BILLING_CRON_STEPS.map((step) => step.name)).toEqual(["notices", "reconcile"]);
  });

  it("reconciles pending payments with the FedaPay client of this deployment", async () => {
    const deps = { db: {}, api: API, notify: vi.fn() } as unknown as ReturnType<typeof applyDeps>;
    const onStuck = vi.fn();
    vi.mocked(getBillingSettings).mockReturnValue(settings());
    vi.mocked(applyDeps).mockReturnValue(deps);
    vi.mocked(stuckAlert).mockReturnValue(onStuck);
    vi.mocked(reconcilePendingPurchases).mockResolvedValue({ checked: 3, granted: 1, expired: 1, failed: 0 });

    expect(await reconcileStep().run(admin)).toEqual({
      ok: true,
      counts: { checked: 3, granted: 1, expired: 1, failed: 0 },
    });
    expect(applyDeps).toHaveBeenCalledWith(settings(), API);
    expect(reconcilePendingPurchases).toHaveBeenCalledWith(deps, { limit: RECONCILE_LIMIT, onStuck });
  });

  it("fails the run when a purchase could not be checked", async () => {
    vi.mocked(getBillingSettings).mockReturnValue(settings());
    vi.mocked(reconcilePendingPurchases).mockResolvedValue({ checked: 2, granted: 0, expired: 0, failed: 1 });

    expect((await reconcileStep().run(admin)).ok).toBe(false);
  });

  it("skips while payments are off, and fails when they are misconfigured", async () => {
    vi.mocked(getBillingSettings).mockReturnValue(
      settings({ environment: null, api: null, problems: ["environment_missing"] }),
    );
    expect(await reconcileStep().run(admin)).toEqual({ ok: true, counts: { skipped: 1 } });

    vi.mocked(getBillingSettings).mockReturnValue(settings({ api: null, problems: ["secret_key_missing"] }));
    expect(await reconcileStep().run(admin)).toEqual({ ok: false, counts: { skipped: 1 } });
    expect(reconcilePendingPurchases).not.toHaveBeenCalled();
  });
});

describe("runCronSteps", () => {
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
