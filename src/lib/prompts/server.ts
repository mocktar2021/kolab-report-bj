import "server-only";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/workspaces/schemas";
import type { ModelTier, OutputSchema, PromptStatus, PromptVariable } from "./catalog";

// Reads go through the user's client, so RLS decides: global templates and
// those of the workspaces the user belongs to. The workspace in the URL then
// narrows that to one workspace.

export type PromptVersionRow = {
  id: string;
  workspaceId: string | null;
  templateKey: string;
  version: number;
  status: PromptStatus;
  title: string;
  description: string | null;
  template: string;
  variables: PromptVariable[];
  outputSchema: OutputSchema;
  modelTier: ModelTier;
  temperature: number | null;
  maxOutputTokens: number | null;
  changelog: string | null;
  createdBy: string | null;
  createdAt: string;
  /** Last time this version became the published one. */
  publishedAt: string | null;
};

const VERSION_COLUMNS =
  "id, workspace_id, template_key, version, status, title, description, template, variables, output_schema, model_tier, temperature, max_output_tokens, changelog, created_by, created_at, published_at";

type VersionRecord = {
  id: string;
  workspace_id: string | null;
  template_key: string;
  version: number;
  status: PromptStatus;
  title: string;
  description: string | null;
  template: string;
  variables: unknown;
  output_schema: string;
  model_tier: string;
  temperature: number | null;
  max_output_tokens: number | null;
  changelog: string | null;
  created_by: string | null;
  created_at: string;
  published_at: string | null;
};

function toRow(record: VersionRecord): PromptVersionRow {
  return {
    id: record.id,
    workspaceId: record.workspace_id,
    templateKey: record.template_key,
    version: record.version,
    status: record.status,
    title: record.title,
    description: record.description,
    template: record.template,
    // The database checks both against the same lists as the catalog.
    variables: Array.isArray(record.variables) ? (record.variables as PromptVariable[]) : [],
    outputSchema: record.output_schema as OutputSchema,
    modelTier: record.model_tier as ModelTier,
    temperature: record.temperature,
    maxOutputTokens: record.max_output_tokens,
    changelog: record.changelog,
    createdBy: record.created_by,
    createdAt: record.created_at,
    publishedAt: record.published_at,
  };
}

/** The version a template shows in the library, without its body. */
export type PromptVersionSummary = Pick<
  PromptVersionRow,
  "id" | "version" | "status" | "title" | "description" | "outputSchema"
>;

export type PromptTemplateSummary = {
  scope: "global" | "workspace";
  templateKey: string;
  /** The published version, or the latest one when none is published. */
  current: PromptVersionSummary;
  latestVersion: number;
  versionCount: number;
  /** "draft" when nothing is published but a draft waits, "archived" when every version is. */
  state: PromptStatus;
};

/**
 * Global templates and those of one workspace, one entry per template, by
 * title. Reads the prompt_templates view, which picks the version to show in
 * the database instead of loading every version's body.
 */
export async function listPromptTemplates(workspaceId: string): Promise<PromptTemplateSummary[] | null> {
  if (!uuidSchema.safeParse(workspaceId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prompt_templates")
    .select(
      "id, workspace_id, template_key, version, status, title, description, output_schema, version_count, latest_version, state",
    )
    .or(`workspace_id.is.null,workspace_id.eq.${workspaceId.toLowerCase()}`);
  if (error || !data) return null;

  return data
    .flatMap((row) =>
      // A view's columns are all nullable in the generated types.
      row.id && row.template_key && row.version && row.status && row.title && row.state
        ? [
            {
              scope: row.workspace_id ? "workspace" : "global",
              templateKey: row.template_key,
              current: {
                id: row.id,
                version: row.version,
                status: row.status,
                title: row.title,
                description: row.description,
                outputSchema: row.output_schema as OutputSchema,
              },
              latestVersion: row.latest_version ?? row.version,
              versionCount: row.version_count ?? 1,
              state: row.state,
            } satisfies PromptTemplateSummary,
          ]
        : [],
    )
    .sort((a, b) => a.current.title.localeCompare(b.current.title, "fr"));
}

export type PromptTemplateDetail = {
  version: PromptVersionRow;
  /** Every version of the template, newest first. */
  history: PromptVersionRow[];
};

/**
 * One version and the history of its template. Null when the version is not
 * global and belongs to another workspace than the one in the URL.
 */
export async function getPromptTemplate(
  workspaceId: string,
  versionId: string,
): Promise<PromptTemplateDetail | null> {
  if (!uuidSchema.safeParse(workspaceId).success || !uuidSchema.safeParse(versionId).success) return null;
  // The database gives ids in lowercase, the URL may not.
  const workspace = workspaceId.toLowerCase();
  const supabase = await createClient();
  const { data: record } = await supabase
    .from("prompt_library")
    .select(VERSION_COLUMNS)
    .eq("id", versionId.toLowerCase())
    .maybeSingle();
  if (!record || (record.workspace_id !== null && record.workspace_id !== workspace)) return null;

  const base = supabase
    .from("prompt_library")
    .select(VERSION_COLUMNS)
    .eq("template_key", record.template_key);
  const { data: history } = await (
    record.workspace_id ? base.eq("workspace_id", record.workspace_id) : base.is("workspace_id", null)
  ).order("version", { ascending: false });
  return { version: toRow(record), history: (history ?? [record]).map(toRow) };
}
