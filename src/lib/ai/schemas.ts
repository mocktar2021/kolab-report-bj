import { z } from "zod";
import { escapeInline } from "@/lib/deliverables/parse/markdown";
import type { OutputSchema } from "@/lib/prompts/catalog";

// What the model returns for each output_schema of a template. The field
// descriptions are in French because the model reads them. Sources point at
// the short refs the context gives each deliverable (L1, L2...), and the
// schema only accepts the refs of the request, so a citation can't name a
// file that wasn't sent. Bump OUTPUT_SCHEMA_VERSION when a shape changes:
// each generation records the version it was checked against.

export const OUTPUT_SCHEMA_VERSION = 1;

/** The refs of one request, as the context numbers them: at least one deliverable. */
export type SourceRefs = readonly [string, ...string[]];

export const OUTPUT_LIMITS = {
  title: 200,
  summary: 2000,
  item: 600,
  detail: 1500,
  body: 30_000,
  sourceDetail: 300,
  findings: 12,
  recommendations: 15,
  observations: 20,
  limits: 10,
  sources: 30,
  itemSources: 10,
} as const;

const PRIORITIES = ["haute", "moyenne", "basse"] as const;

export type RecommendationPriority = (typeof PRIORITIES)[number];

/** Postgres can't store NUL in jsonb, and an injected deliverable could make the model write one. */
function withoutNul(value: string): string {
  return value.replaceAll("\u0000", "");
}

function text(max: number, description: string) {
  return z.string().trim().min(1).max(max).transform(withoutNul).describe(description);
}

function sourcesSchema(refs: SourceRefs) {
  return z
    .array(
      z.object({
        deliverable: z
          .enum([...refs] as [string, ...string[]])
          .describe("Identifiant du livrable cité, par exemple L1."),
        detail: text(OUTPUT_LIMITS.sourceDetail, "Ce qui est repris de ce livrable, en une phrase."),
      }),
    )
    .min(1)
    .max(OUTPUT_LIMITS.sources)
    .describe(
      "Livrables sur lesquels s'appuie le texte, chacun une seule fois. Ne cite que des identifiants fournis.",
    );
}

function itemRefs(refs: SourceRefs) {
  return z
    .array(z.enum([...refs] as [string, ...string[]]))
    .min(1)
    .max(OUTPUT_LIMITS.itemSources)
    .describe("Identifiants des livrables qui justifient cet élément.");
}

export function sectionDraftSchema(refs: SourceRefs) {
  return z.object({
    title: text(OUTPUT_LIMITS.title, "Titre proposé pour la section."),
    summary: text(OUTPUT_LIMITS.summary, "L'essentiel de la section en deux ou trois phrases."),
    body_markdown: text(
      OUTPUT_LIMITS.body,
      "Corps de la section en Markdown : les constats, avec leurs chiffres et ce qui les explique, sous des intertitres quand le contenu le demande. Ne redis pas le résumé. Pas de partie Sources ni Recommandations, qui ont leur propre champ. Intertitres de niveau 3 (###) au plus, listes et tableaux permis. Ni HTML ni images.",
    ),
    recommendations: z
      .array(text(OUTPUT_LIMITS.item, "Une recommandation concrète, en une ou deux phrases."))
      .max(OUTPUT_LIMITS.recommendations)
      .describe(
        "Recommandations qui découlent des constats, seulement si les consignes de la section en demandent. Sinon, liste vide.",
      ),
    sources: sourcesSchema(refs),
  });
}

export function executiveSummarySchema(refs: SourceRefs) {
  return z.object({
    summary: text(OUTPUT_LIMITS.summary * 2, "Résumé exécutif de 150 à 250 mots, en paragraphes."),
    key_points: z
      .array(text(OUTPUT_LIMITS.item, "Un point clé, en une phrase."))
      .min(1)
      .max(OUTPUT_LIMITS.findings)
      .describe("Trois à cinq points clés."),
    sources: sourcesSchema(refs),
  });
}

export function recommendationsSchema(refs: SourceRefs) {
  return z.object({
    introduction: z
      .string()
      .trim()
      .max(OUTPUT_LIMITS.summary)
      .transform(withoutNul)
      .describe("Une ou deux phrases qui introduisent les recommandations. Chaîne vide si inutile."),
    recommendations: z
      .array(
        z.object({
          title: text(OUTPUT_LIMITS.title, "Titre court de la recommandation."),
          rationale: text(OUTPUT_LIMITS.detail, "Le constat qui la justifie."),
          priority: z.enum(PRIORITIES).describe("Priorité : haute, moyenne ou basse."),
          priority_reason: text(OUTPUT_LIMITS.item, "Ce qui motive cette priorité."),
          sources: itemRefs(refs),
        }),
      )
      .min(1)
      .max(OUTPUT_LIMITS.recommendations)
      .describe("Recommandations, de la plus prioritaire à la moins prioritaire."),
    sources: sourcesSchema(refs),
  });
}

export function dataAnalysisSchema(refs: SourceRefs) {
  return z.object({
    summary: text(OUTPUT_LIMITS.summary, "Ce que montrent les données, en deux à quatre phrases."),
    observations: z
      .array(
        z.object({
          label: text(OUTPUT_LIMITS.title, "Intitulé court de l'observation."),
          detail: text(
            OUTPUT_LIMITS.detail,
            "L'observation, avec les chiffres exacts et leur unité tels qu'ils figurent dans les tableaux.",
          ),
          sources: itemRefs(refs),
        }),
      )
      .min(1)
      .max(OUTPUT_LIMITS.observations)
      .describe("Observations tirées des données : ordres de grandeur, évolutions, écarts."),
    limits: z
      .array(text(OUTPUT_LIMITS.item, "Une limite des données."))
      .max(OUTPUT_LIMITS.limits)
      .describe("Limites des données : périodes manquantes, valeurs douteuses, sources à confirmer."),
    sources: sourcesSchema(refs),
  });
}

export type SectionDraftOutput = z.infer<ReturnType<typeof sectionDraftSchema>>;
export type ExecutiveSummaryOutput = z.infer<ReturnType<typeof executiveSummarySchema>>;
export type RecommendationsOutput = z.infer<ReturnType<typeof recommendationsSchema>>;
export type DataAnalysisOutput = z.infer<ReturnType<typeof dataAnalysisSchema>>;

export type DraftOutputByKey = {
  section_draft: SectionDraftOutput;
  executive_summary: ExecutiveSummaryOutput;
  recommendations: RecommendationsOutput;
  data_analysis: DataAnalysisOutput;
};

/** A checked output, tagged with the schema it was checked against. */
export type DraftOutput = {
  [K in OutputSchema]: { schema: K; value: DraftOutputByKey[K] };
}[OutputSchema];

const BUILDERS = {
  section_draft: sectionDraftSchema,
  executive_summary: executiveSummarySchema,
  recommendations: recommendationsSchema,
  data_analysis: dataAnalysisSchema,
} as const satisfies Record<OutputSchema, (refs: SourceRefs) => z.ZodTypeAny>;

/** The zod schema the model must fill for this template, limited to the refs of the request. */
export function outputSchemaFor(key: OutputSchema, refs: SourceRefs): z.ZodTypeAny {
  return BUILDERS[key](refs);
}

/** Checks a raw object against the schema, for stored outputs and the eval runner. */
export function parseDraftOutput(key: OutputSchema, refs: SourceRefs, value: unknown): DraftOutput | null {
  const parsed = outputSchemaFor(key, refs).safeParse(value);
  return parsed.success ? ({ schema: key, value: parsed.data } as DraftOutput) : null;
}

/** Every ref the output cites, once each, in order of first citation. */
export function citedRefs(output: DraftOutput): string[] {
  const refs = new Set<string>();
  if (output.schema === "recommendations") {
    for (const item of output.value.recommendations) item.sources.forEach((ref) => refs.add(ref));
  }
  if (output.schema === "data_analysis") {
    for (const item of output.value.observations) item.sources.forEach((ref) => refs.add(ref));
  }
  for (const source of output.value.sources) refs.add(source.deliverable);
  return [...refs];
}

const PRIORITY_LABELS: Record<RecommendationPriority, string> = {
  haute: "Priorité haute",
  moyenne: "Priorité moyenne",
  basse: "Priorité basse",
};

function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item.replace(/\s*\n\s*/g, " ")}`).join("\n");
}

function sourceList(sources: DraftOutput["value"]["sources"], names: ReadonlyMap<string, string>): string {
  return bullets(
    sources.map(
      (source) => `${escapeInline(names.get(source.deliverable) ?? source.deliverable)} : ${source.detail}`,
    ),
  );
}

function refNames(refs: readonly string[], names: ReadonlyMap<string, string>): string {
  return refs.map((ref) => escapeInline(names.get(ref) ?? ref)).join(", ");
}

/**
 * The Markdown a proposal puts in report_sections.content once accepted.
 * `names` maps each ref to its file name, so the text cites files people know.
 */
export function draftToMarkdown(output: DraftOutput, names: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  switch (output.schema) {
    case "section_draft": {
      const value = output.value;
      parts.push(`**Résumé.** ${value.summary}`);
      parts.push(value.body_markdown);
      if (value.recommendations.length > 0)
        parts.push(`### Recommandations\n\n${bullets(value.recommendations)}`);
      break;
    }
    case "executive_summary": {
      const value = output.value;
      parts.push(value.summary);
      parts.push(`### Points clés\n\n${bullets(value.key_points)}`);
      break;
    }
    case "recommendations": {
      const value = output.value;
      if (value.introduction) parts.push(value.introduction);
      value.recommendations.forEach((item, index) => {
        parts.push(
          `### ${index + 1}. ${item.title}\n\n${item.rationale}\n\n*${PRIORITY_LABELS[item.priority]}.* ${item.priority_reason}\n\nSources : ${refNames(item.sources, names)}`,
        );
      });
      break;
    }
    case "data_analysis": {
      const value = output.value;
      parts.push(value.summary);
      parts.push(
        `### Observations\n\n${value.observations
          .map((item) => `- **${item.label}.** ${item.detail} (${refNames(item.sources, names)})`)
          .join("\n")}`,
      );
      if (value.limits.length > 0) parts.push(`### Limites des données\n\n${bullets(value.limits)}`);
      break;
    }
  }
  parts.push(`### Sources\n\n${sourceList(output.value.sources, names)}`);
  return parts.join("\n\n");
}
