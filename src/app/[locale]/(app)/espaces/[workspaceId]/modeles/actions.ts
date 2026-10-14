"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { log } from "@/lib/log";
import { PROMPT_LIMITS } from "@/lib/prompts/catalog";
import {
  promptFieldErrors,
  promptVersionSchema,
  type PromptFieldErrorKey,
  type PromptVersion,
  type PromptVersionInput,
} from "@/lib/prompts/schema";
import { getPromptTemplate } from "@/lib/prompts/server";
import { templateKeyFromTitle } from "@/lib/prompts/template";
import { createClient } from "@/lib/supabase/server";
import { MANAGER_ROLES } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

// Owners and admins write workspace templates. The checks here mirror RLS,
// the column privileges and the triggers on prompt_library, which have the
// final say: they number, check and sign each version.

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

// Ids are compared with the database's, which are lowercase.
const idSchema = uuidSchema.transform((id) => id.toLowerCase());

const saveRequestSchema = z.object({
  workspaceId: idSchema,
  baseId: idSchema.nullable(),
  expectedLatest: z.number().int().positive().nullable(),
  values: z.record(z.unknown()),
});

function errorKey(error: { code?: string | null }): PromptActionError {
  switch (error.code) {
    // 23505: a version or key someone else just took. 40P01 and 27000: two
    // writes to the same templates crossed.
    case "23505":
    case "40P01":
    case "27000":
      return "conflict";
    case "42501":
      return "forbidden";
    case "22023":
    case "22P02":
    case "22P05":
    case "23514":
      return "invalidInput";
    default:
      return "generic";
  }
}

/** Inserts one version. The trigger refuses `version` when it is not the template's next one. */
async function insertVersion(
  workspaceId: string,
  templateKey: string,
  version: number,
  values: PromptVersion,
) {
  const supabase = await createClient();
  return supabase
    .from("prompt_library")
    .insert({
      workspace_id: workspaceId,
      template_key: templateKey,
      version,
      title: values.title,
      description: values.description,
      template: values.template,
      status: values.publish ? "published" : "draft",
      changelog: values.changelog,
      output_schema: values.outputSchema,
      model_tier: values.modelTier,
      temperature: values.temperature,
      max_output_tokens: values.maxOutputTokens,
    })
    .select("id")
    .single();
}

/** Saves a new template, or a new version of one. Saved versions never change. */
export async function savePromptVersion(request: SavePromptRequest): Promise<SavePromptResult> {
  const parsedRequest = saveRequestSchema.safeParse(request);
  if (!parsedRequest.success) return { ok: false, error: "invalidInput" };
  const { workspaceId, baseId, expectedLatest } = parsedRequest.data;
  const access = await requireWorkspaceRole(workspaceId, MANAGER_ROLES);
  if (!access) return { ok: false, error: "forbidden" };

  const parsed = promptVersionSchema(baseId === null).safeParse(parsedRequest.data.values);
  if (!parsed.success)
    return { ok: false, error: "invalidInput", fieldErrors: promptFieldErrors(parsed.error) };
  const values = parsed.data;

  let result: Awaited<ReturnType<typeof insertVersion>>;
  if (baseId) {
    // Global templates change through migrations only. Customizing one saves a new template.
    const base = await getPromptTemplate(workspaceId, baseId);
    if (!base || base.version.workspaceId !== workspaceId) return { ok: false, error: "notFound" };
    if (expectedLatest === null) return { ok: false, error: "invalidInput" };
    result = await insertVersion(workspaceId, base.version.templateKey, expectedLatest + 1, values);
  } else {
    // A new template takes a key from its title. When the workspace already
    // uses it, the trigger refuses version 1 and the next suffix is tried.
    const key = templateKeyFromTitle(values.title);
    let attempt = 1;
    do {
      const suffix = attempt === 1 ? "" : `-${attempt}`;
      const candidate = `${key.slice(0, PROMPT_LIMITS.keyMax - suffix.length).replace(/-$/, "")}${suffix}`;
      result = await insertVersion(workspaceId, candidate, 1, values);
      attempt++;
    } while (result.error?.code === "23505" && attempt <= 20);
  }

  const { data, error } = result;
  if (error || !data) {
    if (error && errorKey(error) === "generic")
      log.error("prompts: could not save a version", { error: error.message });
    return { ok: false, error: error ? errorKey(error) : "generic" };
  }
  revalidatePath(LIBRARY_PATH, "layout");
  return { ok: true, id: data.id };
}

export type PromptStatusResult = { ok: true } | { ok: false; error: PromptActionError };

const statusRequestSchema = z.object({
  workspaceId: idSchema,
  versionId: idSchema,
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
  const access = await requireWorkspaceRole(parsed.data.workspaceId, MANAGER_ROLES);
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
    if (errorKey(error) === "generic")
      log.error("prompts: could not change a status", { error: error.message });
    return { ok: false, error: errorKey(error) };
  }
  if (!data) return { ok: false, error: "notFound" };
  revalidatePath(LIBRARY_PATH, "layout");
  return { ok: true };
}
