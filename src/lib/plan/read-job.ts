import "server-only";
import { fork } from "node:child_process";
import path from "node:path";
import type { PlanFileResult } from "./read";
import { PLAN_LIMITS, PlanReadError, type PlanFormat } from "./types";
import type { PlanWorkerInput, PlanWorkerOutput } from "./worker";

// Reads a plan file in a child process with its own memory limit and no
// environment, killed at the deadline, the way the deliverables are read
// (src/lib/deliverables/parse-job.ts). The bytes only live in memory: the
// file is never stored.

/** The plan readers bundled by scripts/build-parse-worker.mjs, traced into the route in next.config.mjs. */
export const PLAN_WORKER_FILE = path.join(process.cwd(), "build", "plan-worker.cjs");

/**
 * Runs the plan readers in a child process, killed when it answers, fails or
 * reaches the deadline. Running out of memory aborts it (SIGABRT).
 */
export function readPlanInWorker(
  format: PlanFormat,
  bytes: Uint8Array,
  deadline: number,
  {
    file = PLAN_WORKER_FILE,
    heapMb = PLAN_LIMITS.workerHeapMb,
    requestId = null,
  }: { file?: string; heapMb?: number; requestId?: string | null } = {},
): Promise<PlanFileResult> {
  return new Promise((resolve, reject) => {
    const child = fork(file, [], {
      execArgv: [`--max-old-space-size=${heapMb}`],
      env: { NODE_ENV: process.env.NODE_ENV },
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const timer = setTimeout(
      () => {
        reject(new PlanReadError("timeout"));
        child.kill("SIGKILL");
      },
      Math.max(deadline - Date.now(), 0),
    );
    child.once("message", (output: PlanWorkerOutput) => {
      if (output.ok) resolve(output.result);
      else reject(new PlanReadError(output.key));
    });
    child.once("error", reject);
    // Settles the promise if the process ends without answering.
    child.once("exit", (_code, signal) => {
      clearTimeout(timer);
      reject(new PlanReadError(signal === "SIGABRT" ? "tooLarge" : "unreadable"));
    });
    child.send({ format, bytes, requestId } satisfies PlanWorkerInput);
  });
}
