"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const EVERY_MS = 3000;
const AT_MOST_MS = 3 * 60 * 1000;

/**
 * Refreshes the page while files are being read, so their badges move on
 * without a reload. Gives up after a few minutes: a read that long is shown
 * as stale with a retry button.
 */
export function ParseWatcher({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > AT_MOST_MS) clearInterval(timer);
      else router.refresh();
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [active, router]);

  return null;
}
