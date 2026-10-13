import { z } from "zod";

// Mirrors the public.section_status enum in supabase/migrations.
export const SECTION_STATUSES = ["not_started", "in_progress", "completed"] as const;

export const sectionStatusSchema = z.enum(SECTION_STATUSES);

export type SectionStatus = z.infer<typeof sectionStatusSchema>;
