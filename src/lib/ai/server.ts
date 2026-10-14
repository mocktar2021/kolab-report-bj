import "server-only";
import { z } from "zod";
import { OUTPUT_SCHEMAS, type OutputSchema } from "@/lib/prompts/catalog";
import { createClient } from "@/lib/supabase/server";
import { draftAvailability, type DraftAvailability } from "./config";
import { draftToMarkdown, parseDraftOutput, type DraftOutput } from "./schemas";
import type { DeliverableUse } from "./types";

// What the section page needs for AI drafts, read with the user's rights:
// RLS shows the generations of a section to its editors and managers only.

export type DraftTemplateOption = {
  id: string;
  title: string;
  description: string | null;
  outputSchema: OutputSchema;
  scope: "global" | "workspace";
};

/** A checked draft waiting for the expert's decision. */
export type DraftProposal = {
  generationId: string;
  createdAt: string;
  templateTitle: string | null;
  output: DraftOutput;
  /** What accepting puts in the section, before any edit. */
  markdown: string;
  truncated: boolean;
  deliverables: DeliverableUse[];
  rating: 1 | -1 | null;
  comment: string | null;
  /** Only the person who asked rates a draft. */
  mine: boolean;
};

export type DraftPanelData = {
  availability: DraftAvailability;
  /** Published templates the workspace can use, by title. */
  templates: DraftTemplateOption[];
  /** Deliverables of the section read successfully, the ones a draft can use. */
  parsedCount: number;
  proposal: DraftProposal | null;
  content: string | null;
  /** Sent back on accept, so a section changed meanwhile isn't overwritten. */
  sectionUpdatedAt: string;
};

const deliverableUseSchema = z.object({
  ref: z.string(),
  id: z.string(),
  fileName: z.string(),
  originalTokens: z.number(),
  keptTokens: z.number(),
  truncated: z.boolean(),
  summarized: z.boolean(),
  dropped: z.boolean(),
  rowsCut: z.number(),
});

const contextMetaSchema = z.object({ deliverables: z.array(deliverableUseSchema).min(1) });

/** The deliverables a generation used, from its context_meta. Null when it can't be read. */
export function deliverablesOf(contextMeta: unknown): DeliverableUse[] | null {
  const parsed = contextMetaSchema.safeParse(contextMeta);
  return parsed.success ? parsed.data.deliverables : null;
}

/** The checked output of a stored generation and the Markdown it gives, or null. */
export function storedProposal(
  outputSchema: string,
  output: unknown,
  deliverables: DeliverableUse[],
): { output: DraftOutput; markdown: string } | null {
  const schema = z.enum(OUTPUT_SCHEMAS).safeParse(outputSchema);
  const refs = deliverables.map((use) => use.ref);
  if (!schema.success || refs.length === 0) return null;
  const parsed = parseDraftOutput(schema.data, refs as [string, ...string[]], output);
  if (!parsed) return null;
  const names = new Map(deliverables.map((use) => [use.ref, use.fileName]));
  return { output: parsed, markdown: draftToMarkdown(parsed, names) };
}

export async function getDraftPanel(
  workspaceId: string,
  sectionId: string,
  userId: string,
): Promise<DraftPanelData | null> {
  const supabase = await createClient();
  const [{ data: section }, { data: templates }, { count }, { data: latest }] = await Promise.all([
    supabase
      .from("report_sections")
      .select("content, content_updated_at")
      .eq("id", sectionId)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    supabase
      .from("prompt_library")
      .select("id, workspace_id, title, description, output_schema")
      .eq("status", "published")
      .or(`workspace_id.is.null,workspace_id.eq.${workspaceId.toLowerCase()}`)
      .order("title"),
    supabase
      .from("deliverables")
      .select("id", { count: "exact", head: true })
      .eq("section_id", sectionId)
      .eq("parse_status", "parsed")
      .not("uploaded_at", "is", null),
    // The latest finished draft: a proposal while nobody decided on it.
    supabase
      .from("ai_generations")
      .select(
        "id, created_at, output_schema, output, context_meta, truncated, accepted, user_rating, feedback_comment, requested_by, prompt:prompt_library(title)",
      )
      .eq("section_id", sectionId)
      .eq("status", "succeeded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!section) return null;

  let proposal: DraftProposal | null = null;
  if (latest && latest.accepted === null) {
    const deliverables = deliverablesOf(latest.context_meta);
    const stored = deliverables ? storedProposal(latest.output_schema, latest.output, deliverables) : null;
    if (deliverables && stored) {
      proposal = {
        generationId: latest.id,
        createdAt: latest.created_at,
        templateTitle: latest.prompt?.title ?? null,
        output: stored.output,
        markdown: stored.markdown,
        truncated: latest.truncated,
        deliverables,
        rating: latest.user_rating === 1 || latest.user_rating === -1 ? latest.user_rating : null,
        comment: latest.feedback_comment,
        mine: latest.requested_by === userId,
      };
    }
  }

  const schemas = new Set<string>(OUTPUT_SCHEMAS);
  return {
    availability: draftAvailability(),
    templates: (templates ?? []).flatMap((row) =>
      schemas.has(row.output_schema)
        ? [
            {
              id: row.id,
              title: row.title,
              description: row.description,
              outputSchema: row.output_schema as OutputSchema,
              scope: row.workspace_id ? "workspace" : "global",
            } satisfies DraftTemplateOption,
          ]
        : [],
    ),
    parsedCount: count ?? 0,
    proposal,
    content: section.content,
    // The text version: reordering or reassigning the section doesn't change it.
    sectionUpdatedAt: section.content_updated_at,
  };
}
