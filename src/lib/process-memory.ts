import "server-only";
import { readFileSync } from "node:fs";

// Memory of the child processes that read files (KRB-214). Their heap limit
// (--max-old-space-size) leaves out the buffers outside the V8 heap, where
// pdf.js decodes the streams of a PDF: a 1 MB PDF can decode to gigabytes
// and take the whole function down with the server in it.

/** How often the memory of a child is read. A decoded stream grows by a few MB per millisecond. */
const EVERY_MS = 20;

/** Resident memory of a process in MB, from /proc. Null where there is no /proc, or once the process ended. */
export function residentMb(pid: number): number | null {
  try {
    const kb = /^VmRSS:\s+(\d+) kB$/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1];
    return kb === undefined ? null : Number(kb) / 1024;
  } catch {
    return null;
  }
}

/**
 * Calls `onExceeded` once when the resident memory of process `pid` passes
 * `maxMb`. Linux only, like the servers: elsewhere it watches nothing.
 * Returns the function that stops watching.
 */
export function watchMemory(pid: number, maxMb: number, onExceeded: () => void): () => void {
  if (residentMb(process.pid) === null) return () => undefined;
  const timer = setInterval(() => {
    const used = residentMb(pid);
    if (used === null || used <= maxMb) return;
    clearInterval(timer);
    onExceeded();
  }, EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
