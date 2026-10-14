"use client";

import { useRouter } from "next/navigation";
import { LIVE_DEBOUNCE_MS, VISIBLE_REFRESH_GAP_MS, useLiveSections } from "@/lib/realtime/use-live-sections";

export { LIVE_DEBOUNCE_MS, VISIBLE_REFRESH_GAP_MS };

/**
 * Reloads the page data when a section of the report changes in another
 * session (order, assignment, status, text), when the tab is shown again and
 * when Realtime reconnects after a drop. People only hear about the sections
 * they can read: Realtime applies RLS to each subscriber.
 */
export function useLiveReport(reportId: string) {
  const router = useRouter();
  useLiveSections({
    topic: `report-sections:${reportId}`,
    filter: `report_id=eq.${reportId}`,
    onChange: () => router.refresh(),
  });
}

/** Keeps the master report in step with other sessions. Renders nothing. */
export function LiveReport({ reportId }: { reportId: string }) {
  useLiveReport(reportId);
  return null;
}
