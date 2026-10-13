"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { STALE_PARSE_MS } from "@/lib/deliverables/parse/types";

const EVERY_MS = 3000;
// A little past STALE_PARSE_MS, so the last refresh shows the read as stale.
const AT_MOST_MS = STALE_PARSE_MS + 30_000;

/**
 * Refreshes the page while files are being read, so their badges move on
 * without a reload. `reading` names the files being read: it is empty when
 * none is, and a new value starts the time window over. A read that runs
 * past the window is shown as stale with a retry button.
 */
export function ParseWatcher({ reading }: { reading: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!reading) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > AT_MOST_MS) clearInterval(timer);
      else router.refresh();
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [reading, router]);

  return null;
}
