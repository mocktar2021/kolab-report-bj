"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { wordEditDistance } from "@/lib/ai/metrics";
import { deliverablesOf, storedProposal } from "@/lib/ai/server";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/workspaces/schemas";

// Decisions on an AI draft. The database functions check that the caller
// can edit the section and that the draft still waits for a decision; RLS
// limits ratings to the person who asked for the draft.

export type DraftDecisionError =
  | "forbidden"
  | "notFound"
  | "decided"
  | "conflict"
  | "reportFinal"
  | "readOnly"
  | "invalidInput"
  | "generic";

export type DraftDecisionResult = { ok: true } | { ok: false; error: DraftDecisionError };

const SECTION_PATH = "/[locale]/(app)/espaces/[workspaceId]/sections/[sectionId]";

const CONTENT_MAX = 100_000;

const acceptSchema = z.object({
  generationId: uuidSchema,
  content: z
    .string()
    .max(CONTENT_MAX)
    .refine((value) => value.trim().length > 0 && !value.includes("\u0000")),
  sectionUpdatedAt: z.string().min(1).max(64),
});

function decisionError(error: { code?: string | null; message?: string }): DraftDecisionError {
  switch (error.code) {
    case "42501":
      return "forbidden";
    case "P0002":
      return "notFound";
    case "55000":
      return "decided";
    case "40001":
      return "conflict";
    // The report became final (KRB-20).
    case "KR020":
      return "reportFinal";
    // The workspace became read-only (KRB-178).
    case "KR043":
      return "readOnly";
    case "22023":
    case "22P02":
      return "invalidInput";
    default:
      log.error("ai drafts: could not record a decision", { error: error.message });
      return "generic";
  }
}

/**
 * Puts the proposal, as the expert left it, in the section. The edit
 * distance is measured against the proposal as stored, not as sent.
 */
export async function acceptDraft(input: {
  generationId: string;
  content: string;
  sectionUpdatedAt: string;
}): Promise<DraftDecisionResult> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const { generationId, content, sectionUpdatedAt } = parsed.data;

  const supabase = await createClient();
  const { data: generation } = await supabase
    .from("ai_generations")
    .select("output_schema, output, context_meta")
    .eq("id", generationId.toLowerCase())
    .maybeSingle();
  if (!generation) return { ok: false, error: "notFound" };
  const deliverables = deliverablesOf(generation.context_meta);
  const proposal = deliverables
    ? storedProposal(generation.output_schema, generation.output, deliverables)
    : null;
  if (!proposal) return { ok: false, error: "decided" };

  const { error } = await supabase.rpc("accept_ai_generation", {
    p_generation_id: generationId.toLowerCase(),
    p_content: content,
    p_edit_distance: wordEditDistance(proposal.markdown, content),
    p_section_updated_at: sectionUpdatedAt,
  });
  if (error) return { ok: false, error: decisionError(error) };
  revalidatePath(SECTION_PATH, "page");
  return { ok: true };
}

export async function discardDraft(generationId: string): Promise<DraftDecisionResult> {
  if (!uuidSchema.safeParse(generationId).success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_ai_generation", {
    p_generation_id: generationId.toLowerCase(),
  });
  if (error) return { ok: false, error: decisionError(error) };
  revalidatePath(SECTION_PATH, "page");
  return { ok: true };
}

const ratingSchema = z.object({
  generationId: uuidSchema,
  rating: z.union([z.literal(1), z.literal(-1), z.null()]),
  comment: z
    .string()
    .max(1000)
    .refine((value) => !value.includes("\u0000"))
    .transform((value) => value.trim() || null),
});

export type DraftRatingResult = { ok: true } | { ok: false; error: "forbidden" | "invalidInput" | "generic" };

/** Thumbs up or down and a comment on a draft, by the person who asked for it. */
export async function rateDraft(input: {
  generationId: string;
  rating: 1 | -1 | null;
  comment: string;
}): Promise<DraftRatingResult> {
  const parsed = ratingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_generations")
    .update({ user_rating: parsed.data.rating, feedback_comment: parsed.data.comment })
    .eq("id", parsed.data.generationId.toLowerCase())
    .select("id")
    .maybeSingle();
  if (error) {
    log.error("ai drafts: could not save a rating", { error: error.message });
    return { ok: false, error: "generic" };
  }
  // RLS hides drafts the caller may not rate: nothing was updated.
  if (!data) return { ok: false, error: "forbidden" };
  return { ok: true };
}
