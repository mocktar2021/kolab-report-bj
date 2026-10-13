"use server";

import { after } from "next/server";
import { claimParse, runParse } from "@/lib/deliverables/parse-job";
import type { ParseMeta } from "@/lib/deliverables/parse/types";
import { removeObjects } from "@/lib/deliverables/server";
import { canEditSection, sectionStatusSchema, type SectionStatus } from "@/lib/sections";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

export type DeliverableActionResult = { ok: true } | { ok: false; error: "forbidden" | "busy" | "generic" };

/** A deliverable the caller can edit through its section, read with their rights. */
async function editableDeliverable(id: string) {
  if (!uuidSchema.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("deliverables")
    .select("id, workspace_id, storage_path, section:report_sections(assigned_to)")
    .eq("id", id)
    .not("uploaded_at", "is", null)
    .maybeSingle();
  if (!data) return null;
  const access = await requireWorkspaceRole(data.workspace_id);
  if (!access || !canEditSection(access, data.section?.assigned_to ?? null)) return null;
  return { supabase, deliverable: data };
}

/** "Relancer l'analyse": reads the file again, unless a read is already running. */
export async function retryParse(id: string): Promise<DeliverableActionResult> {
  const found = await editableDeliverable(id);
  if (!found) return { ok: false, error: "forbidden" };
  const claim = await claimParse(found.deliverable.id, found.deliverable.workspace_id);
  if (!claim) return { ok: false, error: "busy" };
  after(() => runParse(claim));
  return { ok: true };
}

/**
 * Deletes the row with the user's rights (RLS: the uploader while the section
 * is theirs, or a manager), then the stored object with the service role.
 */
export async function deleteDeliverable(id: string): Promise<DeliverableActionResult> {
  const found = await editableDeliverable(id);
  if (!found) return { ok: false, error: "forbidden" };
  const { data: deleted, error } = await found.supabase
    .from("deliverables")
    .delete()
    .eq("id", found.deliverable.id)
    .select("storage_path")
    .maybeSingle();
  if (error) {
    console.error("deliverables: could not delete a file", error.message);
    return { ok: false, error: "generic" };
  }
  if (!deleted) return { ok: false, error: "forbidden" };
  await removeObjects([deleted.storage_path]);
  return { ok: true };
}

export type SectionStatusResult = { ok: true; status: SectionStatus } | { ok: false };

/** Status of a section, for its assigned expert or a manager (RLS and the guard trigger agree). */
export async function updateSectionStatus(sectionId: string, status: string): Promise<SectionStatusResult> {
  const parsedStatus = sectionStatusSchema.safeParse(status);
  if (!uuidSchema.safeParse(sectionId).success || !parsedStatus.success) return { ok: false };
  const supabase = await createClient();
  const { data: section } = await supabase
    .from("report_sections")
    .select("id, workspace_id, assigned_to")
    .eq("id", sectionId)
    .maybeSingle();
  if (!section) return { ok: false };
  const access = await requireWorkspaceRole(section.workspace_id);
  if (!access || !canEditSection(access, section.assigned_to)) return { ok: false };
  const { data: updated, error } = await supabase
    .from("report_sections")
    .update({ status: parsedStatus.data })
    .eq("id", section.id)
    .select("status")
    .maybeSingle();
  if (error || !updated) return { ok: false };
  return { ok: true, status: parsedStatus.data };
}

export type DeliverablePreview = { markdown: string | null; meta: ParseMeta | null } | null;

/** What the app read from a file, for any member of the workspace (RLS). */
export async function loadPreview(id: string): Promise<DeliverablePreview> {
  if (!uuidSchema.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("deliverables")
    .select("parsed_content, parse_meta")
    .eq("id", id)
    .not("uploaded_at", "is", null)
    .maybeSingle();
  if (!data) return null;
  return { markdown: data.parsed_content, meta: data.parse_meta as ParseMeta | null };
}
