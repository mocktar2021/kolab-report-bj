"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { MANAGER_ROLES } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

// Progressive rollouts of a workspace template and rollback of a publish
// (Story KRB-17). The database functions check that the caller manages the
// template's workspace and that the rollout or version is in the right
// state; these actions only check the input and map the errors.

export type RolloutActionError =
  | "forbidden"
  | "notFound"
  | "ended"
  | "notDraft"
  | "noPublished"
  | "noPrevious"
  | "conflict"
  | "invalidInput"
  // The organization's plan has no custom templates (KR044), or the workspace is read-only (KR043).
  | "templatesNotIncluded"
  | "readOnly"
  | "generic";

export type RolloutActionResult = { ok: true } | { ok: false; error: RolloutActionError };

const LIBRARY_PATH = "/[locale]/(app)/espaces/[workspaceId]/modeles";

const idSchema = uuidSchema.transform((id) => id.toLowerCase());
const percentSchema = z.number().int().min(1).max(99);

function errorOf(error: { code?: string | null; message?: string }): RolloutActionError {
  switch (error.code) {
    case "42501":
      return "forbidden";
    case "P0002":
      return "notFound";
    case "KR010":
      return "ended";
    case "KR011":
      return "notDraft";
    case "KR012":
      return "noPublished";
    case "KR013":
      return "noPrevious";
    // Another rollout of the template is active.
    case "23505":
      return "conflict";
    case "22023":
    case "22P02":
      return "invalidInput";
    case "KR043":
      return "readOnly";
    case "KR044":
      return "templatesNotIncluded";
    default:
      log.error("prompts: rollout action failed", { error: error.message });
      return "generic";
  }
}

async function manager(workspaceId: string) {
  return requireWorkspaceRole(workspaceId, MANAGER_ROLES);
}

/** Serves a draft version to `percent` % of the generations of its template. */
export async function startRollout(
  workspaceId: string,
  candidateId: string,
  percent: number,
): Promise<RolloutActionResult> {
  const parsed = z
    .object({ workspaceId: idSchema, candidateId: idSchema, percent: percentSchema })
    .safeParse({ workspaceId, candidateId, percent });
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  if (!(await manager(parsed.data.workspaceId))) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_prompt_rollout", {
    p_candidate_id: parsed.data.candidateId,
    p_percent: parsed.data.percent,
  });
  if (error) return { ok: false, error: errorOf(error) };
  revalidatePath(LIBRARY_PATH, "layout");
  return { ok: true };
}

export async function setRolloutPercent(
  workspaceId: string,
  rolloutId: string,
  percent: number,
): Promise<RolloutActionResult> {
  const parsed = z
    .object({ workspaceId: idSchema, rolloutId: idSchema, percent: percentSchema })
    .safeParse({ workspaceId, rolloutId, percent });
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  if (!(await manager(parsed.data.workspaceId))) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_prompt_rollout_percent", {
    p_rollout_id: parsed.data.rolloutId,
    p_percent: parsed.data.percent,
  });
  if (error) return { ok: false, error: errorOf(error) };
  revalidatePath(LIBRARY_PATH, "layout");
  return { ok: true };
}

/** Publishes the candidate for everyone (`promote`) or stops the rollout, leaving it a draft. */
export async function endRollout(
  workspaceId: string,
  rolloutId: string,
  promote: boolean,
): Promise<RolloutActionResult> {
  const parsed = z
    .object({ workspaceId: idSchema, rolloutId: idSchema, promote: z.boolean() })
    .safeParse({ workspaceId, rolloutId, promote });
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  if (!(await manager(parsed.data.workspaceId))) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("end_prompt_rollout", {
    p_rollout_id: parsed.data.rolloutId,
    p_promote: parsed.data.promote,
  });
  if (error) return { ok: false, error: errorOf(error) };
  revalidatePath(LIBRARY_PATH, "layout");
  return { ok: true };
}

export type RollbackResult = { ok: true; versionId: string } | { ok: false; error: RolloutActionError };

/** Puts back the version published before this one, in one step. */
export async function rollbackPublish(workspaceId: string, versionId: string): Promise<RollbackResult> {
  const parsed = z
    .object({ workspaceId: idSchema, versionId: idSchema })
    .safeParse({ workspaceId, versionId });
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  if (!(await manager(parsed.data.workspaceId))) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rollback_prompt_publish", {
    p_version_id: parsed.data.versionId,
  });
  if (error) return { ok: false, error: errorOf(error) };
  revalidatePath(LIBRARY_PATH, "layout");
  return { ok: true, versionId: data };
}
