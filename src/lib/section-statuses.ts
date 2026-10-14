// Mirrors the public.section_status enum in supabase/migrations.
//
// No zod in this module: the app shell's Client Components import it, and
// zod would add about 13 kB of compressed JavaScript to every signed-in page
// (KRB-154). The zod schema lives in src/lib/sections.ts.
export const SECTION_STATUSES = ["not_started", "in_progress", "completed"] as const;

export type SectionStatus = (typeof SECTION_STATUSES)[number];

export function isSectionStatus(value: unknown): value is SectionStatus {
  return typeof value === "string" && (SECTION_STATUSES as readonly string[]).includes(value);
}
