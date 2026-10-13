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
};

const VERSION_COLUMNS =
  "id, workspace_id, template_key, version, status, title, description, template, variables, output_schema, model_tier, temperature, max_output_tokens, changelog, created_by, created_at";

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
  };
}

export type PromptTemplateSummary = {
  scope: "global" | "workspace";
  templateKey: string;
  /** The published version, or the latest one when none is published. */
  current: PromptVersionRow;
  latestVersion: number;
  versionCount: number;
  /** "draft" when nothing is published but a draft waits, "archived" when every version is. */
  state: PromptStatus;
};

/** Global templates and those of one workspace, one entry per template, by title. */
export async function listPromptTemplates(workspaceId: string): Promise<PromptTemplateSummary[] | null> {
  if (!uuidSchema.safeParse(workspaceId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prompt_library")
    .select(VERSION_COLUMNS)
    .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
    .order("version", { ascending: false });
  if (error || !data) return null;

  const templates = new Map<string, PromptVersionRow[]>();
  for (const record of data) {
    const row = toRow(record);
    const id = `${row.workspaceId ?? "global"}/${row.templateKey}`;
    templates.set(id, [...(templates.get(id) ?? []), row]);
  }
  return [...templates.values()]
    .map((versions) => {
      // Newest first, from the query.
      const latest = versions[0] as PromptVersionRow;
      const published = versions.find((row) => row.status === "published");
      return {
        scope: latest.workspaceId ? "workspace" : "global",
        templateKey: latest.templateKey,
        current: published ?? latest,
        latestVersion: latest.version,
        versionCount: versions.length,
        state: published
          ? "published"
          : versions.some((row) => row.status === "draft")
            ? "draft"
            : "archived",
      } satisfies PromptTemplateSummary;
    })
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
  const supabase = await createClient();
  const { data: record } = await supabase
    .from("prompt_library")
    .select(VERSION_COLUMNS)
    .eq("id", versionId)
    .maybeSingle();
  if (!record || (record.workspace_id !== null && record.workspace_id !== workspaceId)) return null;

  const base = supabase
    .from("prompt_library")
    .select(VERSION_COLUMNS)
    .eq("template_key", record.template_key);
  const { data: history } = await (
    record.workspace_id ? base.eq("workspace_id", record.workspace_id) : base.is("workspace_id", null)
  ).order("version", { ascending: false });
  return { version: toRow(record), history: (history ?? [record]).map(toRow) };
}

/** Whether a workspace already has a template with this key. */
export async function promptKeyTaken(workspaceId: string, templateKey: string): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("prompt_library")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("template_key", templateKey);
  return (count ?? 0) > 0;
}
