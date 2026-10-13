"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PROMPT_LIMITS } from "@/lib/prompts/catalog";
import {
  promptFieldErrors,
  promptVersionSchema,
  type PromptFieldErrorKey,
  type PromptVersionInput,
} from "@/lib/prompts/schema";
import { getPromptTemplate, promptKeyTaken } from "@/lib/prompts/server";
import { checkTemplate, templateKeyFromTitle } from "@/lib/prompts/template";
import { createClient } from "@/lib/supabase/server";
import { MANAGER_ROLES } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

// Owners and admins write workspace templates. The checks here mirror RLS and
// the column privileges on prompt_library, which have the final say.

export type PromptActionError = "forbidden" | "notFound" | "conflict" | "invalidInput" | "generic";

export type SavePromptResult =
  | { ok: true; id: string }
  | { ok: false; error: PromptActionError; fieldErrors?: Partial<Record<string, PromptFieldErrorKey>> };

export type SavePromptRequest = {
  workspaceId: string;
  /** Null for a new template, otherwise a version of the workspace template to add a version to. */
  baseId: string | null;
  /** The latest version number the editor was opened on, so a newer one isn't silently replaced. */
  expectedLatest: number | null;
  values: PromptVersionInput;
};

const LIBRARY_PATH = "/[locale]/(app)/espaces/[workspaceId]/modeles";

function errorKey(error: { code?: string | null }): PromptActionError {
  switch (error.code) {
    case "23505":
      return "conflict";
    case "42501":
      return "forbidden";
    case "22023":
    case "22P02":
    case "23514":
      return "invalidInput";
    default:
      return "generic";
  }
}

/** A key from the title that no template of the workspace uses yet. */
async function freeTemplateKey(workspaceId: string, title: string): Promise<string | null> {
  const base = templateKeyFromTitle(title);
  for (let attempt = 1; attempt <= 20; attempt++) {
    const suffix = attempt === 1 ? "" : `-${attempt}`;
    const key = `${base.slice(0, PROMPT_LIMITS.keyMax - suffix.length).replace(/-$/, "")}${suffix}`;
    if (!(await promptKeyTaken(workspaceId, key))) return key;
  }
  return null;
}

/** Saves a new template, or a new version of one. Saved versions never change. */
export async function savePromptVersion(request: SavePromptRequest): Promise<SavePromptResult> {
  const { workspaceId, baseId } = request;
  if (
    !uuidSchema.safeParse(workspaceId).success ||
    (baseId !== null && !uuidSchema.safeParse(baseId).success)
  )
    return { ok: false, error: "invalidInput" };
  const access = await requireWorkspaceRole(workspaceId, MANAGER_ROLES);
  if (!access) return { ok: false, error: "forbidden" };

  const parsed = promptVersionSchema(baseId === null).safeParse(request.values);
  if (!parsed.success)
    return { ok: false, error: "invalidInput", fieldErrors: promptFieldErrors(parsed.error) };
  const values = parsed.data;

  let templateKey: string | null;
  if (baseId) {
    // Global templates change through migrations only. Customizing one saves a new template.
    const base = await getPromptTemplate(workspaceId, baseId);
    if (!base || base.version.workspaceId !== workspaceId) return { ok: false, error: "notFound" };
    if (base.history[0]?.version !== request.expectedLatest) return { ok: false, error: "conflict" };
    templateKey = base.version.templateKey;
  } else {
    templateKey = await freeTemplateKey(workspaceId, values.title);
    if (!templateKey) return { ok: false, error: "conflict" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prompt_library")
    .insert({
      workspace_id: workspaceId,
      template_key: templateKey,
      title: values.title,
      description: values.description,
      template: values.template,
      variables: checkTemplate(values.template).variables,
      status: values.publish ? "published" : "draft",
      changelog: values.changelog,
      output_schema: values.outputSchema,
      model_tier: values.modelTier,
      temperature: values.temperature,
      max_output_tokens: values.maxOutputTokens,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error && errorKey(error) === "generic")
      console.error("prompts: could not save a version", error.message);
    return { ok: false, error: error ? errorKey(error) : "generic" };
  }
  revalidatePath(LIBRARY_PATH, "layout");
  return { ok: true, id: data.id };
}

export type PromptStatusResult = { ok: true } | { ok: false; error: PromptActionError };

const statusRequestSchema = z.object({
  workspaceId: uuidSchema,
  versionId: uuidSchema,
  status: z.enum(["published", "archived"]),
});

/**
 * Publishes a version (the trigger archives the one published before), or
 * archives one. Publishing an older version brings it back into use.
 */
export async function setPromptStatus(
  workspaceId: string,
  versionId: string,
  status: "published" | "archived",
): Promise<PromptStatusResult> {
  const parsed = statusRequestSchema.safeParse({ workspaceId, versionId, status });
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const access = await requireWorkspaceRole(workspaceId, MANAGER_ROLES);
  if (!access) return { ok: false, error: "forbidden" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prompt_library")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.versionId)
    .eq("workspace_id", parsed.data.workspaceId)
    .select("id")
    .maybeSingle();
  if (error) {
    if (errorKey(error) === "generic") console.error("prompts: could not change a status", error.message);
    return { ok: false, error: errorKey(error) };
  }
  if (!data) return { ok: false, error: "notFound" };
  revalidatePath(LIBRARY_PATH, "layout");
  return { ok: true };
}
