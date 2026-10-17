"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { log } from "@/lib/log";
import { PLAN_LIMITS } from "@/lib/plan/types";
import { createClient } from "@/lib/supabase/server";
import { sectionInstructionsSchema, sectionTitleSchema, uuidSchema } from "@/lib/workspaces/schemas";

// "Créer les N sections" on the import page (KRB-196). One call to
// import_report_plan, with the user's rights: it checks the role and the
// report, and creates the whole plan or nothing. The triggers on
// report_sections check the parent, a final report and a read-only
// workspace.

export type ImportPlanErrorKey =
  "invalidInput" | "forbidden" | "reportFinal" | "readOnly" | "tooManySections" | "generic";

export type ImportPlanResult = { ok: true; count: number } | { ok: false; error: ImportPlanErrorKey };

export type ImportPlanItem = { title: string; level: 1 | 2; instructions: string };

const planSchema = z.object({
  reportId: uuidSchema,
  items: z
    .array(
      z.object({
        title: sectionTitleSchema,
        level: z.union([z.literal(1), z.literal(2)]),
        instructions: sectionInstructionsSchema,
      }),
    )
    .min(1)
    .max(PLAN_LIMITS.maxItems)
    .refine((items) => items[0]?.level === 1),
});

export async function importPlan(reportId: string, items: ImportPlanItem[]): Promise<ImportPlanResult> {
  const parsed = planSchema.safeParse({ reportId, items });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_report_plan", {
    p_report_id: parsed.data.reportId.toLowerCase(),
    p_items: parsed.data.items.map((item) => ({
      title: item.title,
      level: item.level,
      instructions: item.instructions || null,
    })),
  });
  if (error) {
    switch (error.code) {
      case "42501":
      case "P0002":
        return { ok: false, error: "forbidden" };
      case "KR020":
        return { ok: false, error: "reportFinal" };
      // The workspace became read-only (KRB-178).
      case "KR043":
        return { ok: false, error: "readOnly" };
      case "KR052":
        return { ok: false, error: "tooManySections" };
      case "22023":
      case "23514":
        return { ok: false, error: "invalidInput" };
      default:
        log.error("plan import: could not create the sections", { error: error.message });
        return { ok: false, error: "generic" };
    }
  }

  revalidatePath("/", "layout");
  return { ok: true, count: data ?? parsed.data.items.length };
}
