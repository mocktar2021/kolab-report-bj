"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { log } from "@/lib/log";
import { MAX_SECTION_CONTENT } from "@/lib/sections";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/workspaces/schemas";

// Saving the text of a section by hand (Story KRB-18). The editor sends back
// the version it loaded; if someone saved in between, nothing is written and
// the editor gets the current text to compare.

export type SectionContentVersion = { content: string | null; version: string };

export type SaveSectionContentResult =
  | { ok: true; version: string }
  | { ok: false; error: "conflict"; current: SectionContentVersion }
  | { ok: false; error: "forbidden" | "reportFinal" | "tooLong" | "invalidInput" | "generic" };

const saveSchema = z.object({
  sectionId: uuidSchema,
  content: z.string(),
  // The content_updated_at string as loaded, kept as is: a JS Date would lose
  // the microseconds and never match.
  expectedVersion: z.string().min(1).max(64),
});

// NUL can't be stored in Postgres text.
const NUL = new RegExp(String.fromCharCode(0), "g");

export async function saveSectionContent(input: {
  sectionId: string;
  content: string;
  expectedVersion: string;
}): Promise<SaveSectionContentResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const content = parsed.data.content.replace(NUL, "");
  if (content.length > MAX_SECTION_CONTENT) return { ok: false, error: "tooLong" };
  const sectionId = parsed.data.sectionId.toLowerCase();

  const supabase = await createClient();
  const { data: version, error } = await supabase.rpc("save_section_content", {
    p_section_id: sectionId,
    p_content: content,
    p_expected_version: parsed.data.expectedVersion,
  });
  if (error) {
    switch (error.code) {
      case "40001": {
        const { data: current } = await supabase
          .from("report_sections")
          .select("content, content_updated_at")
          .eq("id", sectionId)
          .maybeSingle();
        if (!current) return { ok: false, error: "forbidden" };
        return {
          ok: false,
          error: "conflict",
          current: { content: current.content, version: current.content_updated_at },
        };
      }
      case "42501":
      case "P0002":
        return { ok: false, error: "forbidden" };
      // The report became final (KRB-20).
      case "KR020":
        return { ok: false, error: "reportFinal" };
      case "22023":
        return { ok: false, error: "tooLong" };
      case "22007":
      case "22008":
        return { ok: false, error: "invalidInput" };
      default:
        log.error("sections: could not save the text", { error: error.message });
        return { ok: false, error: "generic" };
    }
  }
  revalidatePath("/", "layout");
  return { ok: true, version };
}
