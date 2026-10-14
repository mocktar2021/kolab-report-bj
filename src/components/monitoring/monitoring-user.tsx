"use client";

import { useEffect } from "react";
import { loadBrowserSentry, loadedBrowserSentry } from "@/lib/monitoring/browser";

/**
 * Tags browser errors with the signed-in user's id (KRB-136), the same id the
 * server uses, and nothing else. Cleared when the signed-in layout unmounts,
 * on sign-out. Does nothing while Sentry is off.
 */
export function MonitoringUser({ id }: { id: string }) {
  useEffect(() => {
    void loadBrowserSentry().then((sentry) => sentry?.setUser({ id }));
    return () => loadedBrowserSentry()?.setUser(null);
  }, [id]);
  return null;
}
