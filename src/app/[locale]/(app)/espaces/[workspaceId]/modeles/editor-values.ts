import type { ModelTier, OutputSchema } from "@/lib/prompts/catalog";
import type { PromptVersionRow } from "@/lib/prompts/server";

/** What the editor form holds. Numbers stay text until the schema reads them. */
export type EditorValues = {
  title: string;
  description: string;
  template: string;
  outputSchema: OutputSchema;
  modelTier: ModelTier;
  temperature: string;
  maxOutputTokens: string;
  changelog: string;
};

export const EMPTY_EDITOR_VALUES: EditorValues = {
  title: "",
  description: "",
  template: "",
  outputSchema: "section_draft",
  modelTier: "standard",
  temperature: "",
  maxOutputTokens: "",
  changelog: "",
};

/** The fields of a saved version, with a comma in the temperature as French users type it. */
export function editorValuesFrom(row: PromptVersionRow, changelog = ""): EditorValues {
  return {
    title: row.title,
    description: row.description ?? "",
    template: row.template,
    outputSchema: row.outputSchema,
    modelTier: row.modelTier,
    temperature: row.temperature === null ? "" : String(row.temperature).replace(".", ","),
    maxOutputTokens: row.maxOutputTokens === null ? "" : String(row.maxOutputTokens),
    changelog,
  };
}
