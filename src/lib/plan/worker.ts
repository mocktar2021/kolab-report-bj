import { createLogger } from "../log/format";
import { readErrorKey, readPlanFile, type PlanFileResult } from "./read";
import { PlanReadError, type PlanFormat, type PlanReadErrorKey } from "./types";

// Reads one plan file in a child process (./read-job.ts), like the
// deliverables worker: a file that needs too much memory or time ends this
// process, not the server. No environment, so no key the server holds.

export type PlanWorkerInput = { format: PlanFormat; bytes: Uint8Array; requestId: string | null };
export type PlanWorkerOutput = { ok: true; result: PlanFileResult } | { ok: false; key: PlanReadErrorKey };

function answer(output: PlanWorkerOutput) {
  process.send?.(output, () => process.exit(0));
}

process.once("message", ({ format, bytes, requestId }: PlanWorkerInput) => {
  const log = createLogger(() => requestId);
  readPlanFile(format, bytes).then(
    (result) => answer({ ok: true, result }),
    (error: unknown) => {
      if (!(error instanceof PlanReadError)) log.error("plan import: read failed", { error });
      answer({ ok: false, key: readErrorKey(error) });
    },
  );
});
