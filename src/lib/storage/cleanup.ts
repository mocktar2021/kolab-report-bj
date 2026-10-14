import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";

// Removes the stored files of deleted rows (KRB-166). Deleting a
// deliverable, an export, a report or a workspace queues the paths of their
// files in private.storage_cleanup_queue (migration 20261014140000). This
// job, run once a day by /api/cron/storage-cleanup, deletes the manual
// exports past their retention, then removes the queued objects in batches.
//
// `admin` is the service-role client. The queue is global by design, so
// nothing here is scoped by workspace_id: the job only ever removes paths
// the database queued when their row was deleted.

export const STORAGE_CLEANUP_BUCKETS = ["deliverables", "exports"] as const;

/** Days a manual export is kept. A final report's snapshot stays as long as the report. */
export const EXPORT_RETENTION_DAYS = 90;

/** Paths claimed at once. Storage removes up to 1000 per call. */
export const CLEANUP_BATCH_SIZE = 100;

/** Stops claiming after this long, under the route's 60 second limit. */
export const CLEANUP_TIME_BUDGET_MS = 45_000;

type Bucket = (typeof STORAGE_CLEANUP_BUCKETS)[number];

/** What the route answers: counts only, never a path. */
export type StorageCleanupSummary = {
  /** Manual exports deleted because they were past the retention. */
  expiredExports: number;
  /** Queued paths cleared: the object is removed, or was already gone. */
  removed: number;
  /** Paths whose removal failed. They stay queued for the next run. */
  failed: number;
  /** The time budget ran out before the queue was empty. */
  timedOut: boolean;
  /** False when a database call failed. */
  ok: boolean;
};

export type StorageCleanupOptions = {
  retentionDays?: number;
  batchSize?: number;
  budgetMs?: number;
  now?: () => number;
};

function isBucket(value: string): value is Bucket {
  return (STORAGE_CLEANUP_BUCKETS as readonly string[]).includes(value);
}

/** Groups a claimed batch by bucket, since Storage removes per bucket. */
function groupByBucket(batch: { id: number; bucket: string; path: string }[]) {
  const groups = new Map<string, { ids: number[]; paths: string[] }>();
  for (const row of batch) {
    const group = groups.get(row.bucket) ?? { ids: [], paths: [] };
    group.ids.push(row.id);
    group.paths.push(row.path);
    groups.set(row.bucket, group);
  }
  return groups;
}

export async function runStorageCleanup(
  admin: SupabaseClient<Database>,
  options: StorageCleanupOptions = {},
): Promise<StorageCleanupSummary> {
  const {
    retentionDays = EXPORT_RETENTION_DAYS,
    batchSize = CLEANUP_BATCH_SIZE,
    budgetMs = CLEANUP_TIME_BUDGET_MS,
    now = Date.now,
  } = options;
  const deadline = now() + budgetMs;
  const summary: StorageCleanupSummary = {
    expiredExports: 0,
    removed: 0,
    failed: 0,
    timedOut: false,
    ok: true,
  };

  // First, so the files of the expired exports go in this same run.
  const { data: expired, error: expireError } = await admin.rpc("expire_report_exports", {
    p_days: retentionDays,
  });
  if (expireError) {
    log.error("storage-cleanup: could not expire old exports", { error: expireError.message });
    summary.ok = false;
  } else {
    summary.expiredExports = expired ?? 0;
  }

  for (;;) {
    if (now() >= deadline) {
      summary.timedOut = true;
      break;
    }
    const { data: batch, error: claimError } = await admin.rpc("claim_storage_cleanup", {
      p_limit: batchSize,
    });
    if (claimError || !batch) {
      log.error("storage-cleanup: could not claim paths", { error: claimError?.message });
      summary.ok = false;
      break;
    }
    if (batch.length === 0) break;

    for (const [bucket, { ids, paths }] of groupByBucket(batch)) {
      const { error: removeError } = isBucket(bucket)
        ? await admin.storage.from(bucket).remove(paths)
        : { error: { message: "unknown bucket" } };
      if (removeError) {
        // The paths stay queued with the error, and come back next run.
        log.error("storage-cleanup: could not remove files", { bucket, error: removeError.message });
        summary.failed += ids.length;
      } else {
        summary.removed += ids.length;
      }

      const { error: finishError } = await admin.rpc("finish_storage_cleanup", {
        p_ids: ids,
        p_error: removeError?.message,
      });
      if (finishError) {
        // The claim holds these paths for 15 minutes, then the next run
        // removes them again, which is harmless.
        log.error("storage-cleanup: could not record removals", { error: finishError.message });
        summary.ok = false;
        return summary;
      }
    }

    if (batch.length < batchSize) break;
  }

  return summary;
}
