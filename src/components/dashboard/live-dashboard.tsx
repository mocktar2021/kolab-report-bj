"use client";

import { useRouter } from "next/navigation";
import { useLiveSections } from "@/lib/realtime/use-live-sections";

/**
 * Reloads the dashboard when a section of the workspace changes in another
 * session, when the tab is shown again and when Realtime reconnects after a
 * drop. Renders nothing.
 */
export function LiveDashboard({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  // Realtime applies RLS to each subscriber: people only hear about the sections they can read.
  useLiveSections({
    topic: `workspace-sections:${workspaceId}`,
    filter: `workspace_id=eq.${workspaceId}`,
    onChange: () => router.refresh(),
  });
  return null;
}
