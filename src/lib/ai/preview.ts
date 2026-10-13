import { escapeInline } from "@/lib/deliverables/parse/markdown";
import type { OutputSchema } from "@/lib/prompts/catalog";

// The Markdown of a draft while it streams in. The partial object isn't
// checked: fields may be missing, cut in the middle, or of the wrong type.
// This mirrors draftToMarkdown in schemas.ts, so a complete and valid object
// gives the same text: change both together (preview.test.ts compares them).

type Fields = Record<string, unknown>;

const PRIORITY_LABELS = new Map([
  ["haute", "Priorité haute"],
  ["moyenne", "Priorité moyenne"],
  ["basse", "Priorité basse"],
]);

function fields(value: unknown): Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : {};
}

/** A string field, trimmed like the schema does. Anything else counts as missing. */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The non-empty strings of an array field. */
function texts(value: unknown): string[] {
  return items(value).map(text).filter(Boolean);
}

function bullets(lines: readonly string[]): string {
  return lines.map((line) => `- ${line.replace(/\s*\n\s*/g, " ")}`).join("\n");
}

function nameOf(ref: string, names: ReadonlyMap<string, string>): string {
  return escapeInline(names.get(ref) ?? ref);
}

function refNames(refs: readonly string[], names: ReadonlyMap<string, string>): string {
  return refs.map((ref) => nameOf(ref, names)).join(", ");
}

function sourceList(value: unknown, names: ReadonlyMap<string, string>): string | null {
  const lines = items(value).flatMap((item) => {
    const source = fields(item);
    const ref = text(source.deliverable);
    const detail = text(source.detail);
    if (!ref) return detail ? [detail] : [];
    return [detail ? `${nameOf(ref, names)} : ${detail}` : nameOf(ref, names)];
  });
  return lines.length > 0 ? `### Sources\n\n${bullets(lines)}` : null;
}

function listSection(title: string, value: unknown): string | null {
  const lines = texts(value);
  return lines.length > 0 ? `### ${title}\n\n${bullets(lines)}` : null;
}

function recommendation(item: unknown, index: number, names: ReadonlyMap<string, string>): string | null {
  const value = fields(item);
  const title = text(value.title);
  const rationale = text(value.rationale);
  const priority = PRIORITY_LABELS.get(text(value.priority));
  const reason = text(value.priority_reason);
  const refs = texts(value.sources);
  const parts = [
    title ? `### ${index + 1}. ${title}` : null,
    rationale || null,
    priority && reason ? `*${priority}.* ${reason}` : priority ? `*${priority}.*` : reason || null,
    refs.length > 0 ? `Sources : ${refNames(refs, names)}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function observation(item: unknown, names: ReadonlyMap<string, string>): string | null {
  const value = fields(item);
  const label = text(value.label);
  const detail = text(value.detail);
  const refs = texts(value.sources);
  const parts = [
    label ? `**${label}.**` : null,
    detail || null,
    refs.length > 0 ? `(${refNames(refs, names)})` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? `- ${parts.join(" ")}` : null;
}

/**
 * Markdown for a draft still streaming, built from what has arrived so far.
 * Never throws. `names` maps each ref (L1, L2...) to its file name.
 */
export function partialDraftMarkdown(
  schema: OutputSchema,
  partial: unknown,
  names: ReadonlyMap<string, string>,
): string {
  const value = fields(partial);
  const parts: (string | null)[] = [];
  switch (schema) {
    case "section_draft": {
      const summary = text(value.summary);
      parts.push(summary ? `**Résumé.** ${summary}` : null);
      parts.push(listSection("Points clés", value.key_findings));
      parts.push(text(value.body_markdown) || null);
      parts.push(listSection("Recommandations", value.recommendations));
      break;
    }
    case "executive_summary": {
      parts.push(text(value.summary) || null);
      parts.push(listSection("Points clés", value.key_points));
      break;
    }
    case "recommendations": {
      parts.push(text(value.introduction) || null);
      items(value.recommendations).forEach((item, index) => parts.push(recommendation(item, index, names)));
      break;
    }
    case "data_analysis": {
      parts.push(text(value.summary) || null);
      const lines = items(value.observations).flatMap((item) => observation(item, names) ?? []);
      parts.push(lines.length > 0 ? `### Observations\n\n${lines.join("\n")}` : null);
      parts.push(listSection("Limites des données", value.limits));
      break;
    }
  }
  parts.push(sourceList(value.sources, names));
  return parts.filter((part): part is string => part !== null).join("\n\n");
}
