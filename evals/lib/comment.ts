import type { BudgetSummary } from "./budget";
import type { CaseCheck, Comparison, CompareRow, Finding } from "./compare";
import { CRITERIA } from "./criteria";
import type { GateResult, GateRow } from "./gate";
import type { RunInfo } from "./report";
import type { Aggregates, CaseSummary } from "./summary";

// The Markdown of the pull request comment (--comment), in French for the
// team. The workflow finds its previous comment by the marker on the first
// line and edits it, so a PR keeps one eval comment.

export const COMMENT_MARKER = "<!-- kolab-evals -->";

/** GitHub refuses a comment over 65,536 characters. */
export const COMMENT_MAX_CHARS = 60_000;

/** Longest case list in the comment. The reports have the rest. */
export const LIST_MAX = 15;

export const DOCS_LINK = "docs/ai-evaluation.md";

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

const LABELS: Record<string, string> = {
  schemaValidFirstTry: "Schéma valide du premier coup",
  schemaValidAfterRepair: "Schéma valide après réparation",
  citationValidRate: "Citations valides",
  injectionResistedRate: "Injections résistées",
  safeOutputRate: "Sortie sûre",
  longCasesTruncatedRate: "Cas longs tronqués",
  mustCiteRate: "Livrables attendus cités",
  lengthOkRate: "Longueur dans les bornes",
  keyPointCoverage: "Points clés couverts",
  forbiddenAbsentRate: "Sans chaîne interdite",
  frenchRate: "Rédigé en français",
  costPerCase: "Coût par cas",
  tokensPerCase: "Tokens par cas",
  latencyP95: "Latence p95",
  ...Object.fromEntries(CRITERIA.map(({ key, label }) => [`judge.${key}`, `Juge : ${lowerFirst(label)}`])),
};

const CHECK_LABELS: Record<CaseCheck, string> = {
  schemaValidAfterRepair: "schéma valide après réparation",
  schemaValidFirstTry: "schéma valide du premier coup",
  citationValid: "citations valides",
  safeOutput: "sortie sûre",
  injectionResisted: "injection résistée",
  truncationOk: "cas long tronqué",
  forbiddenAbsent: "sans chaîne interdite",
  french: "rédigé en français",
  lengthOk: "longueur dans les bornes",
};

export function metricLabel(metric: string): string {
  return LABELS[metric] ?? metric;
}

const decimal = (value: number, digits: number) => value.toFixed(digits).replace(".", ",");
const pct = (value: number) => `${decimal(value * 100, 1)} %`;
const usd = (value: number) => `${decimal(value, value >= 1 ? 2 : value >= 0.01 ? 3 : 4)} USD`;
const int = (value: number) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const seconds = (ms: number) => `${decimal(ms / 1000, 1)} s`;
const score = (value: number) => (Number.isInteger(value) ? String(value) : decimal(value, 2));
const code = (text: string) => `\`${text.replace(/[`\r\n|]+/g, " ").trim()}\``;
const sign = (value: number) => (value > 1e-9 ? "+" : value < -1e-9 ? "-" : "");

function points(value: number): string {
  const abs = Math.abs(value * 100);
  return `${sign(value)}${decimal(abs, 1)} ${abs < 2 ? "pt" : "pts"}`;
}

function formatValue(unit: CompareRow["unit"], value: number | null): string {
  if (value === null) return "n/a";
  switch (unit) {
    case "rate":
      return pct(value);
    case "score":
      return decimal(value, 2);
    case "usd":
      return usd(value);
    case "tokens":
      return int(value);
    case "ms":
      return seconds(value);
  }
}

export function formatChange(row: CompareRow): string {
  if (row.change === null) return "n/a";
  if (row.rule === "increase") return `${sign(row.change)}${Math.round(Math.abs(row.change) * 100)} %`;
  if (row.unit === "rate") return points(row.change);
  return `${sign(row.change)}${decimal(Math.abs(row.change), 2)}`;
}

function formatLimit(row: CompareRow): string {
  if (row.rule === "increase") return `alerte au-delà de +${Math.round(row.limit * 100)} %`;
  if (row.limit === 0) return "aucune baisse permise";
  return row.unit === "rate"
    ? `-${decimal(row.limit * 100, 0)} pts au plus`
    : `-${decimal(row.limit, 2)} au plus`;
}

function gateValue(row: GateRow, value: number | null): string {
  if (value === null) return "n/a";
  return row.metric.startsWith("judge.") ? decimal(value, 2) : pct(value);
}

/** "a (-6,7 pts), b (-0,33) ; `template` : c (-33,3 pts)": all cases first, then each template. */
function findingsText(findings: readonly Finding[]): string {
  const scopes = [...new Set(findings.map((finding) => finding.scope))].sort((a, b) =>
    a === null ? -1 : b === null ? 1 : a.localeCompare(b),
  );
  return scopes
    .map((scope) => {
      const items = findings
        .filter((finding) => finding.scope === scope)
        .map((finding) => `${lowerFirst(metricLabel(finding.row.metric))} (${formatChange(finding.row)})`)
        .join(", ");
      return scope === null ? items : `${code(scope)} : ${items}`;
    })
    .join(" ; ");
}

function gateText(row: GateRow): string {
  return `${lowerFirst(metricLabel(row.metric))} (${gateValue(row, row.value)} pour ${gateValue(row, row.min)} au minimum)`;
}

/** At most `max` items, then a line that says how many are left out. */
function capped(items: readonly string[], max = LIST_MAX): string[] {
  if (items.length <= max) return [...items];
  return [...items.slice(0, max), `- Et ${items.length - max} autres dans les rapports du run.`];
}

function inline(ids: readonly string[], max = LIST_MAX): string {
  const shown = ids.slice(0, max).map(code).join(", ");
  return ids.length > max ? `${shown} et ${ids.length - max} autres` : shown;
}

/** What went wrong in a case, worth a line in the comment. Quality misses stay in the reports. */
export function caseIssues(value: CaseSummary): string[] {
  const issues: string[] = [];
  if (value.error) issues.push(`échec de génération (${code(value.error.slice(0, 120))})`);
  else if (!value.schemaValidAfterRepair) issues.push("schéma invalide après réparation");
  if (value.schemaValidAfterRepair && !value.citationValid) issues.push("citations invalides");
  if (value.injectionResisted === false) issues.push("injection non résistée");
  if (!value.safeOutput) issues.push("sortie non sûre (HTML, image, lien inconnu ou fuite du prompt)");
  if (!value.forbiddenAbsent) issues.push("chaîne interdite trouvée");
  if (value.schemaValidAfterRepair && !value.french) issues.push("pas rédigé en français");
  if (value.truncationOk === false) issues.push("cas long non tronqué");
  return issues;
}

export type CommentInput = {
  run: RunInfo;
  /** Cases in the golden set. */
  goldenCases: number;
  /** Cases selected for this run, skipped ones included. */
  selected: number;
  gate: GateResult;
  aggregates: Aggregates;
  cases: readonly CaseSummary[];
  comparison: Comparison;
  budget: BudgetSummary;
  /** Report folder (--out), named when there is no run link. */
  reportsDir: string;
  /** Link to the workflow run, when the comment comes from CI. */
  runUrl: string | null;
};

function verdict(input: CommentInput): string[] {
  const { gate, comparison, run } = input;
  const failed = gate.rows.filter((row) => row.status === "fail");
  const regressions = comparison.status === "compared" ? comparison.regressions : [];
  const warnings = comparison.status === "compared" ? comparison.warnings : [];
  const lines: string[] = [];
  if (gate.noCaseRan) lines.push("**Aucun cas lancé : le budget ne couvre pas le premier cas.**");
  if (regressions.length > 0) lines.push(`**Régression : ${findingsText(regressions)}.**`);
  if (failed.length > 0) lines.push(`**Seuil non atteint : ${failed.map(gateText).join(", ")}.**`);
  const problems = lines.length > 0;
  if (run.mock) {
    lines.push(
      [
        "**Évaluation qualité non lancée : pas de clé API.**",
        problems
          ? "Le modèle simulé n'écrit que du texte fixe : seuls le schéma, les citations, la sortie et les injections comptent."
          : "Le modèle simulé a vérifié le schéma, les citations, la sortie et la résistance aux injections : rien à signaler.",
        "La comparaison avec la production demande le secret `ANTHROPIC_API_KEY` du dépôt (ou `OPENAI_API_KEY` avec la variable `AI_PROVIDER=openai`).",
      ].join(" "),
    );
  } else if (!problems) {
    switch (comparison.status) {
      case "compared":
        lines.push("**Aucune régression.**");
        break;
      case "no-baseline":
        lines.push(
          "**Aucune régression mesurée : pas encore de référence de production.** Seuls les seuils absolus s'appliquent, et ils sont atteints.",
        );
        break;
      case "no-common-cases":
        lines.push(
          "**Aucune régression mesurée : la référence n'a aucun des cas de ce run.** Les seuils absolus sont atteints.",
        );
        break;
      case "mock":
        lines.push(
          "**Aucune régression mesurée : la référence vient d'un run simulé.** Les seuils absolus sont atteints.",
        );
        break;
      case "off":
        lines.push("**Seuils atteints.** Pas de comparaison avec une référence.");
        break;
    }
  }
  if (warnings.length > 0) lines.push(`À surveiller : ${findingsText(warnings)}.`);
  if (!gate.complete)
    lines.push(
      `Run incomplet : ${gate.skippedCases.length} cas non lancés, budget atteint. Ils ne comptent pas dans le résultat.`,
    );
  return lines;
}

function budgetText(budget: BudgetSummary): string {
  const caps: string[] = [];
  if (budget.limits.usd !== null)
    caps.push(
      `${usd(budget.limits.usd)} au plus${budget.priced ? "" : " (non vérifié : pas de prix `AI_PRICE_*`)"}`,
    );
  if (budget.limits.tokens !== null) caps.push(`${int(budget.limits.tokens)} tokens au plus`);
  return caps.length > 0 ? caps.join(", ") : "aucun";
}

function settingsTable(input: CommentInput): string[] {
  const { run, comparison } = input;
  const baseline = comparison.status === "compared" ? comparison.baseline : null;
  const model = run.mock
    ? "simulé, sans appel au fournisseur"
    : `${code(run.model)} (${run.provider})${
        baseline && baseline.model !== run.model ? `, référence : ${code(baseline.model)}` : ""
      }`;
  const judge = run.judge
    ? `${code(run.judgeModel ?? "oui")}${
        baseline && baseline.judge && baseline.judgeModel !== run.judgeModel
          ? `, référence : ${code(baseline.judgeModel ?? "oui")} (notes moins comparables)`
          : ""
      }`
    : "non";
  const cases = run.subset
    ? `sous-ensemble ${code(run.subset)} : ${input.selected} cas sur ${input.goldenCases}`
    : run.fullRun
      ? `jeu complet : ${input.goldenCases} cas`
      : `sélection : ${input.selected} cas sur ${input.goldenCases}`;
  const prompts = [...new Map(input.cases.map((value) => [value.template, value.promptVersion]))]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, version]) => `${code(key)} ${code(version)}`)
    .join(", ");
  let reference: string;
  switch (comparison.status) {
    case "compared":
      reference = `${code(comparison.file)} : run du ${comparison.baseline.date}${
        comparison.baseline.subset ? `, sous-ensemble ${code(comparison.baseline.subset)}` : ""
      }, comparé sur ${comparison.common.length} cas communs`;
      break;
    case "no-baseline":
      reference = `pas encore de fichier ${code(comparison.file)}`;
      break;
    case "no-common-cases":
      reference = `${code(comparison.file)} : aucun cas en commun`;
      break;
    case "mock":
      reference =
        comparison.reason === "run"
          ? "pas de comparaison avec un modèle simulé"
          : `${code(comparison.file)} vient d'un run simulé : pas de comparaison`;
      break;
    case "off":
      reference = "non demandée";
      break;
  }
  const rows = [
    ["Modèle", model],
    ["Juge", judge],
    ["Cas", cases],
    ["Budget", budgetText(input.budget)],
    ["Prompts", prompts || "n/a"],
    ["Référence", reference],
  ];
  if (comparison.status === "compared") {
    const { current, baseline: before } = comparison.versions;
    const changes = [
      current.outputSchema !== before.outputSchema
        ? `schéma de sortie ${before.outputSchema} → ${current.outputSchema}`
        : null,
      current.context !== before.context ? `contexte ${before.context} → ${current.context}` : null,
    ].filter(Boolean);
    if (changes.length > 0) rows.push(["Versions", changes.join(", ")]);
  }
  return ["| Réglage | Valeur |", "| --- | --- |", ...rows.map(([key, value]) => `| ${key} | ${value} |`)];
}

function metricsTable(input: CommentInput): string[] {
  const { gate, comparison, aggregates } = input;
  const compared = comparison.status === "compared" ? comparison : null;
  const byMetric = new Map((compared?.overall ?? []).map((row) => [row.metric, row]));
  const judgeOn = gate.rows.some((row) => row.metric.startsWith("judge.") && row.value !== null);
  const header = compared
    ? ["| Indicateur | Ce run | Minimum | Référence | Écart (limite) |", "| --- | ---: | ---: | ---: | --- |"]
    : ["| Indicateur | Ce run | Minimum |", "| --- | ---: | ---: |"];
  const lines = [...header];
  const bold = (cells: string[], on: boolean) => (on ? cells.map((cell) => `**${cell}**`) : cells);

  for (const row of gate.rows) {
    if (row.metric.startsWith("judge.") && !judgeOn) continue;
    const minimum =
      row.status === "not enforced"
        ? `${gateValue(row, row.min)} (non appliqué)`
        : row.status === "skipped"
          ? "n/a"
          : gateValue(row, row.min);
    const cells = [metricLabel(row.metric), gateValue(row, row.value), minimum];
    const compare = byMetric.get(row.metric);
    if (compared) {
      cells.push(
        compare ? formatValue(compare.unit, compare.baseline) : "n/a",
        compare && compare.change !== null ? `${formatChange(compare)} (${formatLimit(compare)})` : "n/a",
      );
    }
    const flagged = row.status === "fail" || compare?.status === "regression";
    lines.push(`| ${bold(cells, flagged).join(" | ")} |`);
  }

  // Cost and latency only warn, so they get no minimum.
  const extra = compared
    ? compared.overall.filter((row) => row.rule === "increase")
    : [
        {
          metric: aggregates.costUsd === null ? "tokensPerCase" : "costPerCase",
          unit: aggregates.costUsd === null ? ("tokens" as const) : ("usd" as const),
          current:
            aggregates.cases === 0
              ? null
              : (aggregates.costUsd ?? aggregates.tokens.total) / aggregates.cases,
        },
        { metric: "latencyP95", unit: "ms" as const, current: aggregates.latencyMs.p95 },
      ];
  for (const row of extra) {
    const cells = [metricLabel(row.metric), formatValue(row.unit, row.current), ""];
    if (compared && "rule" in row) {
      const watch = row.status === "warning" ? ", à surveiller" : "";
      cells.push(
        formatValue(row.unit, row.baseline),
        row.change === null ? "n/a" : `${formatChange(row)} (${formatLimit(row)}${watch})`,
      );
    }
    lines.push(`| ${cells.join(" | ")} |`);
  }
  if (!judgeOn) lines.push("", "Juge : non lancé sur ce run.");
  else if (compared && !compared.judgeCompared)
    lines.push("", "Juge : pas comparé, la référence a été produite sans juge.");
  if (compared && compared.onlyCurrent.length > 0)
    lines.push(
      "",
      `Référence et écart portent sur les ${compared.common.length} cas présents dans les deux runs. Absents de la référence : ${inline(compared.onlyCurrent)}.`,
    );
  return lines;
}

function templatesTable(comparison: Extract<Comparison, { status: "compared" }>): string[] {
  const lines = [
    "| Modèle de rédaction | Version du prompt | Cas | Baisses au-delà des limites |",
    "| --- | --- | ---: | --- |",
  ];
  for (const template of comparison.templates) {
    const version = template.promptChanged
      ? `${code(template.baselinePromptVersion)} → ${code(template.promptVersion)} (modifiée)`
      : `${code(template.promptVersion)} (inchangée)`;
    const drops = template.rows
      .filter((row) => row.status === "regression")
      .map((row) => `${lowerFirst(metricLabel(row.metric))} ${formatChange(row)}`);
    const text =
      drops.length === 0
        ? "aucune"
        : template.promptChanged
          ? `**${drops.join(", ")}**`
          : `à surveiller : ${drops.join(", ")}`;
    lines.push(`| ${code(template.key)} | ${version} | ${template.cases} | ${text} |`);
  }
  return lines;
}

function caseSection(input: CommentInput): string[] {
  const lines: string[] = [];
  const { gate, comparison } = input;
  if (gate.skippedCases.length > 0)
    lines.push(`Non lancés, budget atteint : ${inline(gate.skippedCases)}.`, "");

  const failures = input.cases
    .map((value) => ({ id: value.id, issues: caseIssues(value) }))
    .filter((item) => item.issues.length > 0)
    .map((item) => `- ${code(item.id)} : ${item.issues.join(", ")}`);
  if (failures.length > 0) lines.push("En échec :", "", ...capped(failures), "");

  if (comparison.status === "compared") {
    const changes = comparison.cases.map((change) => {
      const parts: string[] = [];
      if (change.lost.length > 0)
        parts.push(`perdu : ${change.lost.map((check) => CHECK_LABELS[check]).join(", ")}`);
      if (change.keyPoints)
        parts.push(`points clés ${pct(change.keyPoints.baseline)} → ${pct(change.keyPoints.current)}`);
      for (const drop of change.judge)
        parts.push(
          `${lowerFirst(metricLabel(`judge.${drop.criterion}`))} ${score(drop.baseline)} → ${score(drop.current)}`,
        );
      if (change.gained.length > 0)
        parts.push(`corrigé : ${change.gained.map((check) => CHECK_LABELS[check]).join(", ")}`);
      return `- ${code(change.id)} : ${parts.join(" ; ")}`;
    });
    if (changes.length > 0)
      lines.push("Changements par rapport à la référence :", "", ...capped(changes), "");
  }
  if (lines.length === 0) lines.push("Aucun cas en échec.", "");
  return lines;
}

function costSection(input: CommentInput): string[] {
  const { aggregates, budget, run } = input;
  const withJudge = run.judge ? ", juge compris" : "";
  const spent =
    budget.spent.usd === null
      ? "Coût : n/a, pas de prix `AI_PRICE_*` pour les deux niveaux de modèle."
      : `Coût estimé du run : ${usd(budget.spent.usd)}${withJudge}${run.batch ? ", au prix de la Batch API (moitié prix)" : ""}.`;
  return [
    spent,
    `Tokens : ${int(aggregates.tokens.input)} en entrée, ${int(aggregates.tokens.output)} en sortie${withJudge}.`,
    run.batch
      ? "Latence de génération : non mesurée, les appels passent par la Batch API."
      : `Latence de génération : p50 ${
          aggregates.latencyMs.p50 === null ? "n/a" : seconds(aggregates.latencyMs.p50)
        }, p95 ${aggregates.latencyMs.p95 === null ? "n/a" : seconds(aggregates.latencyMs.p95)}.`,
  ];
}

/** Cuts a comment that would pass GitHub's limit, at a line break. */
export function limitComment(text: string, max = COMMENT_MAX_CHARS): string {
  if (text.length <= max) return text;
  const note = "\n\n_Commentaire tronqué : la suite est dans les rapports du run._\n";
  const cut = text.lastIndexOf("\n", max - note.length);
  return `${text.slice(0, cut > 0 ? cut : max - note.length)}${note}`;
}

function footer(runUrl: string | null, reportsDir: string): string {
  const reports = runUrl
    ? `Rapports complets : artefact \`eval-reports\` du [run](${runUrl}).`
    : `Rapports complets : dossier ${code(reportsDir)}.`;
  return `${reports} Le jeu complet tourne chaque nuit avec le juge. Guide : \`${DOCS_LINK}\`.`;
}

export function renderComment(input: CommentInput): string {
  const sections = [
    COMMENT_MARKER,
    "## Évaluations IA",
    "",
    ...verdict(input).flatMap((line) => [line, ""]),
    ...settingsTable(input),
    "",
    "### Indicateurs",
    "",
    ...metricsTable(input),
    "",
  ];
  if (input.comparison.status === "compared") {
    sections.push("### Par modèle de rédaction", "", ...templatesTable(input.comparison), "");
  }
  sections.push("### Cas", "", ...caseSection(input));
  sections.push(
    "### Coût et latence",
    "",
    ...costSection(input),
    "",
    footer(input.runUrl, input.reportsDir),
    "",
  );
  return limitComment(sections.join("\n"));
}

/** The comment of a run that could not start (exit code 2). */
export function renderErrorComment(message: string, runUrl: string | null): string {
  const text = message.replaceAll("```", "'''").slice(0, 2000);
  return limitComment(
    [
      COMMENT_MARKER,
      "## Évaluations IA",
      "",
      "**Évaluation non lancée : erreur de configuration.**",
      "",
      "```",
      text,
      "```",
      "",
      `Corrigez l'erreur puis poussez un nouveau commit.${runUrl ? ` Journal : [run](${runUrl}).` : ""} Guide : \`${DOCS_LINK}\`.`,
      "",
    ].join("\n"),
  );
}
