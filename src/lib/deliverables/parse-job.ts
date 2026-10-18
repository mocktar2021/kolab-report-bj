import "server-only";
import { fork } from "node:child_process";
import path from "node:path";
import { getRequestId, log } from "@/lib/log";
import { watchMemory } from "@/lib/process-memory";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { type FileExtension, fileTypeFor } from "./file-types";
import {
  isParsed,
  PARSE_LIMITS,
  ParseError,
  type ParseResult,
  STALE_PARSE_MS,
  STORED_RESULT,
} from "./parse/types";
import type { WorkerInput, WorkerOutput } from "./parse/worker";
import { DELIVERABLES_BUCKET } from "./server";

// Reading a deliverable runs with the service role, after the request that
// asked for it has answered (next/server after()). The parsers run in a
// child process with its own memory limit and no environment, killed at the
// deadline. A worker thread wouldn't do: --max-old-space-size in NODE_OPTIONS
// overrides its heap limit, and running out of memory there aborts the whole
// server. Users never write the parse columns.

/** The parsers bundled by scripts/build-parse-worker.mjs, traced into the functions in next.config.mjs. */
export const PARSE_WORKER_FILE = path.join(process.cwd(), "build", "parse-worker.cjs");

/** updated_at is the claim's version: a later claim changes it, and the older run can no longer save. */
export type ParseClaim = {
  id: string;
  workspace_id: string;
  storage_path: string;
  file_name: string;
  updated_at: string;
};

/**
 * Marks a checked file as being read, unless a read is already running.
 * Pending and failed files can be claimed, and running ones once stale.
 * `kept` claims a skipped file too, for one the app reads now (isKeptUnread).
 */
export async function claimParse(
  id: string,
  workspaceId: string,
  { kept = false }: { kept?: boolean } = {},
): Promise<ParseClaim | null> {
  const staleBefore = new Date(Date.now() - STALE_PARSE_MS).toISOString();
  const statuses = kept ? "pending,failed,skipped" : "pending,failed";
  const { data, error } = await createAdminClient()
    .from("deliverables")
    .update({ parse_status: "processing", parse_error: null })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .not("uploaded_at", "is", null)
    .or(`parse_status.in.(${statuses}),and(parse_status.eq.processing,updated_at.lt.${staleBefore})`)
    .select("id, workspace_id, storage_path, file_name, updated_at")
    .maybeSingle();
  if (error) log.error("deliverables: could not claim a parse", { error: error.message });
  return data;
}

/** A PDF starts no new page this close to the deadline, so the pages already read are saved. */
const PDF_STOP_MS = 5_000;

/**
 * Runs the parsers in a child process, killed when it answers, fails or
 * reaches the deadline. Running out of heap aborts it (SIGABRT), and past
 * `memoryMb` in all it is killed: the file is then too large.
 * `requestId` goes on the lines the process logs.
 */
export function parseInWorker(
  extension: FileExtension,
  bytes: Uint8Array,
  deadline: number,
  {
    file = PARSE_WORKER_FILE,
    heapMb = PARSE_LIMITS.workerHeapMb,
    memoryMb = PARSE_LIMITS.workerMemoryMb,
    requestId = null,
  }: { file?: string; heapMb?: number; memoryMb?: number; requestId?: string | null } = {},
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const child = fork(file, [], {
      execArgv: [`--max-old-space-size=${heapMb}`],
      env: { NODE_ENV: process.env.NODE_ENV },
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const timer = setTimeout(
      () => {
        reject(new ParseError("timeout"));
        child.kill("SIGKILL");
      },
      Math.max(deadline - Date.now(), 0),
    );
    const stopWatching = child.pid
      ? watchMemory(child.pid, memoryMb, () => {
          reject(new ParseError("tooLarge"));
          child.kill("SIGKILL");
        })
      : () => undefined;
    child.once("message", (output: WorkerOutput) => {
      if (output.ok) resolve(output.result);
      else reject(new ParseError(output.key));
    });
    child.once("error", reject);
    // Settles the promise if the process ends without answering.
    child.once("exit", (_code, signal) => {
      clearTimeout(timer);
      stopWatching();
      reject(new ParseError(signal === "SIGABRT" ? "tooLarge" : "unreadable"));
    });
    child.send({ extension, bytes, requestId, stopAt: deadline - PDF_STOP_MS } satisfies WorkerInput);
  });
}

/** Reads a claimed file and stores the Markdown, or why it failed. Never throws. */
export async function runParse(claim: ParseClaim): Promise<void> {
  const admin = createAdminClient();
  const save = async (values: {
    parse_status: "parsed" | "skipped" | "failed";
    parsed_content: string | null;
    parse_meta: Json | null;
    parse_error: string | null;
  }): Promise<boolean> => {
    const { error } = await admin
      .from("deliverables")
      .update({ ...values, parsed_at: values.parse_status === "failed" ? null : new Date().toISOString() })
      .eq("id", claim.id)
      .eq("workspace_id", claim.workspace_id)
      .eq("parse_status", "processing")
      .eq("updated_at", claim.updated_at);
    if (error) log.error("deliverables: could not save a parse", { error: error.message });
    return !error;
  };
  const fail = (key: string) =>
    save({ parse_status: "failed", parsed_content: null, parse_meta: null, parse_error: key });

  const deadline = Date.now() + PARSE_LIMITS.timeoutMs;
  try {
    const type = fileTypeFor(claim.file_name);
    if (!type) throw new ParseError("unreadable");
    let result = STORED_RESULT;
    if (isParsed(type.extension)) {
      const { data, error } = await admin.storage
        .from(DELIVERABLES_BUCKET)
        .download(claim.storage_path, {}, { signal: AbortSignal.timeout(deadline - Date.now()) });
      if (error || !data) throw new ParseError("unreadable");
      result = await parseInWorker(type.extension, new Uint8Array(await data.arrayBuffer()), deadline, {
        requestId: await getRequestId(),
      });
    }
    const saved = await save({
      parse_status: result.status,
      parsed_content: result.status === "parsed" ? result.markdown : null,
      parse_meta: result.meta as Json,
      parse_error: null,
    });
    // Postgres refuses some text (a NUL byte, for one): the file is then marked as unreadable.
    if (!saved) await fail("unreadable");
  } catch (error) {
    if (!(error instanceof ParseError)) log.error("deliverables: parse failed", { error });
    await fail(error instanceof ParseError ? error.key : "unreadable");
  }
}
