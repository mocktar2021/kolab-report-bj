import { createLogger } from "../../log/format";
import type { FileExtension } from "../file-types";
import { parseDeliverableFile } from "./index";
import { ParseError, type ParseErrorKey, type ParseResult } from "./types";

// Reads one file in a child process (src/lib/deliverables/parse-job.ts). A
// file that needs too much memory or time ends this process, not the server.
// The process gets no environment, so no key the server holds. It logs
// with the request id the server passes, in the server's line format.

/** stopAt: Date.now() past which a PDF starts no new page, so what was read can still be saved. */
export type WorkerInput = {
  extension: FileExtension;
  bytes: Uint8Array;
  requestId: string | null;
  stopAt?: number;
};
export type WorkerOutput = { ok: true; result: ParseResult } | { ok: false; key: ParseErrorKey };

function answer(output: WorkerOutput) {
  process.send?.(output, () => process.exit(0));
}

process.once("message", ({ extension, bytes, requestId, stopAt }: WorkerInput) => {
  const log = createLogger(() => requestId);
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  parseDeliverableFile(extension, buffer, { stopAt }).then(
    (result) => answer({ ok: true, result }),
    (error: unknown) => {
      if (!(error instanceof ParseError)) log.error("deliverables: parse failed", { error });
      answer({ ok: false, key: error instanceof ParseError ? error.key : "unreadable" });
    },
  );
});
