import "server-only";
import { inRollout } from "@/lib/ai/rollout-bucket";
import { createClient } from "@/lib/supabase/server";

// Prompt rollouts (Story KRB-17), read with the user's rights: members see
// the rollouts of their workspace templates and the global ones that reach
// their workspace. They change through the functions of migration
// 20261014000000_ai_observability_rollouts.sql, called from rollout-actions.ts.

export type ActiveRollout = {
  id: string;
  candidateId: string;
  candidateVersion: number | null;
  baseId: string | null;
  percent: number;
  /** Global templates only: the one workspace that gets the candidate. */
  targetWorkspaceId: string | null;
  createdBy: string | null;
  createdAt: string;
};

type RolloutRecord = {
  id: string;
  candidate_id: string;
  base_id: string | null;
  percent: number;
  target_workspace_id: string | null;
  created_by: string | null;
  created_at: string;
  candidate: { version: number } | null;
};

const ROLLOUT_COLUMNS =
  "id, candidate_id, base_id, percent, target_workspace_id, created_by, created_at, candidate:prompt_library!prompt_rollouts_candidate_id_fkey(version)";

function toRollout(record: RolloutRecord): ActiveRollout {
  return {
    id: record.id,
    candidateId: record.candidate_id,
    candidateVersion: record.candidate?.version ?? null,
    baseId: record.base_id,
    percent: record.percent,
    targetWorkspaceId: record.target_workspace_id,
    createdBy: record.created_by,
    createdAt: record.created_at,
  };
}

/** The active rollout of a template, or null. `templateWorkspaceId` is null for a global template. */
export async function getActiveRollout(
  templateWorkspaceId: string | null,
  templateKey: string,
): Promise<ActiveRollout | null> {
  const supabase = await createClient();
  const base = supabase
    .from("prompt_rollouts")
    .select(ROLLOUT_COLUMNS)
    .eq("template_key", templateKey)
    .eq("status", "active");
  const { data } = await (
    templateWorkspaceId ? base.eq("workspace_id", templateWorkspaceId) : base.is("workspace_id", null)
  ).maybeSingle();
  return data ? toRollout(data as RolloutRecord) : null;
}

/**
 * Active rollouts of a workspace's templates and of the global ones that
 * reach it, by template key. A global rollout aimed at another workspace the
 * user also belongs to is left out.
 */
export async function listActiveRollouts(workspaceId: string): Promise<Map<string, ActiveRollout>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("prompt_rollouts")
    .select(`template_key, workspace_id, ${ROLLOUT_COLUMNS}`)
    .eq("status", "active")
    .or(`workspace_id.is.null,workspace_id.eq.${workspaceId.toLowerCase()}`)
    .or(`target_workspace_id.is.null,target_workspace_id.eq.${workspaceId.toLowerCase()}`);
  const rollouts = new Map<string, ActiveRollout>();
  for (const row of data ?? []) {
    const scope = row.workspace_id ? "workspace" : "global";
    rollouts.set(`${scope}:${row.template_key}`, toRollout(row as unknown as RolloutRecord));
  }
  return rollouts;
}

/** Whether a published version has an earlier published one to go back to. */
export async function hasPreviousPublished(version: {
  workspaceId: string | null;
  templateKey: string;
  publishedAt: string | null;
}): Promise<boolean> {
  if (!version.workspaceId || !version.publishedAt) return false;
  const supabase = await createClient();
  const { count } = await supabase
    .from("prompt_library")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", version.workspaceId)
    .eq("template_key", version.templateKey)
    .eq("status", "archived")
    .not("published_at", "is", null)
    .lt("published_at", version.publishedAt);
  return (count ?? 0) > 0;
}

/**
 * The version a draft of this section uses: the candidate of an active
 * rollout when the section falls in its share (and, for a global template
 * limited to one workspace, when it is that workspace), else the published
 * version the expert picked.
 */
export async function versionForSection(
  published: { id: string; workspaceId: string | null; templateKey: string },
  sectionWorkspaceId: string,
  sectionId: string,
): Promise<{ versionId: string; rolloutId: string | null }> {
  const rollout = await getActiveRollout(published.workspaceId, published.templateKey);
  if (
    rollout &&
    rollout.candidateId !== published.id &&
    (rollout.targetWorkspaceId === null || rollout.targetWorkspaceId === sectionWorkspaceId) &&
    inRollout(rollout, sectionId)
  ) {
    return { versionId: rollout.candidateId, rolloutId: rollout.id };
  }
  return { versionId: published.id, rolloutId: null };
}
