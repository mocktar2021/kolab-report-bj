// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runStorageCleanup } from "./cleanup";

type QueuedPath = { id: number; bucket: string; path: string };

const W = "11111111-1111-4111-8111-111111111111";

const QUEUE: QueuedPath[] = [
  { id: 1, bucket: "deliverables", path: `${W}/s1/a-plan.docx` },
  { id: 2, bucket: "exports", path: `${W}/r1/e1.pdf` },
  { id: 3, bucket: "deliverables", path: `${W}/s1/b-mesures.csv` },
  { id: 4, bucket: "exports", path: `${W}/r1/e2.docx` },
  { id: 5, bucket: "deliverables", path: `${W}/s2/c-annexe.pdf` },
];

/** Service-role client stand-in: an in-memory queue and buckets that record removals. */
function fakeAdmin(
  queue: QueuedPath[],
  options: { expired?: number; failingRpc?: string; failingBucket?: string } = {},
) {
  const waiting = [...queue];
  const finished: { ids: number[]; error: string | undefined }[] = [];
  const removed: { bucket: string; paths: string[] }[] = [];

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === options.failingRpc) return { data: null, error: { message: `${name} failed` } };
    switch (name) {
      case "expire_report_exports":
        return { data: options.expired ?? 0, error: null };
      case "claim_storage_cleanup":
        return { data: waiting.splice(0, args.p_limit as number), error: null };
      case "finish_storage_cleanup": {
        const ids = args.p_ids as number[];
        finished.push({ ids, error: args.p_error as string | undefined });
        return { data: ids.length, error: null };
      }
      default:
        throw new Error(`unexpected rpc ${name}`);
    }
  });
  const from = vi.fn((bucket: string) => ({
    remove: async (paths: string[]) => {
      removed.push({ bucket, paths });
      return bucket === options.failingBucket
        ? { data: null, error: { message: "Storage unavailable" } }
        : { data: [], error: null };
    },
  }));

  const client = { rpc, storage: { from } } as unknown as Parameters<typeof runStorageCleanup>[0];
  return { client, rpc, from, finished, removed };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("runStorageCleanup", () => {
  it("expires old exports, then removes every queued file bucket by bucket", async () => {
    const admin = fakeAdmin(QUEUE, { expired: 3 });

    const summary = await runStorageCleanup(admin.client, { batchSize: 2 });

    expect(summary).toEqual({ expiredExports: 3, removed: 5, failed: 0, timedOut: false, ok: true });
    expect(admin.rpc).toHaveBeenNthCalledWith(1, "expire_report_exports", { p_days: 90 });
    expect(admin.rpc.mock.calls.filter(([name]) => name === "claim_storage_cleanup")).toEqual([
      ["claim_storage_cleanup", { p_limit: 2 }],
      ["claim_storage_cleanup", { p_limit: 2 }],
      ["claim_storage_cleanup", { p_limit: 2 }],
    ]);
    expect(admin.removed).toEqual([
      { bucket: "deliverables", paths: [`${W}/s1/a-plan.docx`] },
      { bucket: "exports", paths: [`${W}/r1/e1.pdf`] },
      { bucket: "deliverables", paths: [`${W}/s1/b-mesures.csv`] },
      { bucket: "exports", paths: [`${W}/r1/e2.docx`] },
      { bucket: "deliverables", paths: [`${W}/s2/c-annexe.pdf`] },
    ]);
    expect(admin.finished).toEqual([
      { ids: [1], error: undefined },
      { ids: [2], error: undefined },
      { ids: [3], error: undefined },
      { ids: [4], error: undefined },
      { ids: [5], error: undefined },
    ]);
  });

  it("removes a batch with one call per bucket", async () => {
    const admin = fakeAdmin(QUEUE);

    await runStorageCleanup(admin.client);

    expect(admin.removed).toEqual([
      {
        bucket: "deliverables",
        paths: [`${W}/s1/a-plan.docx`, `${W}/s1/b-mesures.csv`, `${W}/s2/c-annexe.pdf`],
      },
      { bucket: "exports", paths: [`${W}/r1/e1.pdf`, `${W}/r1/e2.docx`] },
    ]);
    expect(admin.finished).toEqual([
      { ids: [1, 3, 5], error: undefined },
      { ids: [2, 4], error: undefined },
    ]);
  });

  it("keeps the paths of a failed removal queued with the error", async () => {
    const admin = fakeAdmin(QUEUE, { failingBucket: "exports" });

    const summary = await runStorageCleanup(admin.client);

    expect(summary).toMatchObject({ removed: 3, failed: 2, ok: true });
    expect(admin.finished).toContainEqual({ ids: [2, 4], error: "Storage unavailable" });
  });

  it("never sends a path to a bucket it does not know", async () => {
    const admin = fakeAdmin([{ id: 9, bucket: "avatars", path: `${W}/photo.png` }]);

    const summary = await runStorageCleanup(admin.client);

    expect(admin.from).not.toHaveBeenCalled();
    expect(admin.finished).toEqual([{ ids: [9], error: "unknown bucket" }]);
    expect(summary).toMatchObject({ removed: 0, failed: 1 });
  });

  it("still empties the queue when expiring exports fails", async () => {
    const admin = fakeAdmin(QUEUE, { failingRpc: "expire_report_exports" });

    const summary = await runStorageCleanup(admin.client);

    expect(summary).toEqual({ expiredExports: 0, removed: 5, failed: 0, timedOut: false, ok: false });
  });

  it("stops when it cannot claim paths", async () => {
    const admin = fakeAdmin(QUEUE, { failingRpc: "claim_storage_cleanup" });

    const summary = await runStorageCleanup(admin.client);

    expect(summary).toMatchObject({ removed: 0, ok: false });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("stops when it cannot record a removal", async () => {
    const admin = fakeAdmin(QUEUE, { failingRpc: "finish_storage_cleanup" });

    const summary = await runStorageCleanup(admin.client, { batchSize: 2 });

    expect(summary.ok).toBe(false);
    expect(admin.removed).toHaveLength(1);
  });

  it("stops claiming once the time budget is spent", async () => {
    const admin = fakeAdmin(QUEUE);
    const clock = [0, 500, 1500];
    const now = vi.fn(() => clock.shift() ?? 1500);

    const summary = await runStorageCleanup(admin.client, { batchSize: 2, budgetMs: 1000, now });

    expect(summary).toMatchObject({ removed: 2, timedOut: true, ok: true });
    expect(admin.rpc.mock.calls.filter(([name]) => name === "claim_storage_cleanup")).toHaveLength(1);
  });

  it("answers counts only, never a path", async () => {
    const admin = fakeAdmin(QUEUE, { failingBucket: "deliverables" });

    const summary = await runStorageCleanup(admin.client);

    expect(JSON.stringify(summary)).not.toContain(W);
  });
});
