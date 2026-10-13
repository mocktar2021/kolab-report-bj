import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { PromptMetrics, RecentGeneration } from "@/lib/ai/metrics-server";
import messages from "../../../../../../../messages/fr.json";
import { EmptyMetrics, MetricsTable, SummaryTiles } from "./metrics-table";
import { PeriodSwitch } from "./period-switch";
import { RecentGenerations } from "./recent-generations";
import { summarizeMetrics } from "./summary";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode; className?: string }) => (
    <a href={`/fr${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const WORKSPACE_ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";
const GLOBAL_VERSION = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_VERSION = "22222222-2222-4222-8222-222222222222";

function metrics(overrides: Partial<PromptMetrics> = {}): PromptMetrics {
  return {
    promptVersionId: GLOBAL_VERSION,
    templateKey: "section_synthesis",
    version: 2,
    title: "Synthèse de section",
    scope: "global",
    model: "claude-sonnet-5-5",
    generations: 120,
    succeeded: 110,
    failed: 6,
    failureRate: 6 / 116,
    accepted: 30,
    discarded: 10,
    acceptanceRate: 0.75,
    rated: 20,
    meanRating: 0.5,
    meanEditRatio: 0.125,
    inputTokens: 1_234_567,
    outputTokens: 98_765,
    totalTokens: 1_333_332,
    cost: 0.0042,
    p50LatencyMs: 1234,
    p95LatencyMs: 3456,
    fromRollout: 0,
    lastGeneration: "2026-10-13T08:00:00.000000+00:00",
    ...overrides,
  };
}

const ROLLOUT_ROW = metrics({
  promptVersionId: WORKSPACE_VERSION,
  templateKey: "client_summary",
  version: 4,
  title: "Résumé pour le client",
  scope: "workspace",
  generations: 12,
  succeeded: 12,
  failed: 0,
  failureRate: 0,
  accepted: 2,
  discarded: 2,
  acceptanceRate: 0.5,
  rated: 4,
  meanRating: -0.5,
  cost: 1.5,
  fromRollout: 12,
});

/** A version used once, still running: every rate is unknown. */
const NULL_ROW = metrics({
  promptVersionId: null,
  templateKey: null,
  version: null,
  title: null,
  scope: null,
  model: "gpt-5-mini",
  generations: 1,
  succeeded: 0,
  failed: 0,
  failureRate: null,
  accepted: 0,
  discarded: 0,
  acceptanceRate: null,
  rated: 0,
  meanRating: null,
  meanEditRatio: null,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cost: null,
  p50LatencyMs: null,
  p95LatencyMs: null,
});

function withIntl(children: ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      {children}
    </NextIntlClientProvider>,
  );
}

describe("summarizeMetrics", () => {
  it("adds the rows up and weighs the rates by what they were computed from", () => {
    const summary = summarizeMetrics([metrics(), ROLLOUT_ROW, NULL_ROW]);
    expect(summary.generations).toBe(133);
    expect(summary.fromRollout).toBe(12);
    expect(summary.decided).toBe(44);
    expect(summary.acceptanceRate).toBeCloseTo(32 / 44);
    // 20 ratings at 0.5 and 4 at -0.5: mean 1/3, so two thirds of thumbs up.
    expect(summary.rated).toBe(24);
    expect(summary.positiveShare).toBeCloseTo(2 / 3);
    expect(summary.finished).toBe(128);
    expect(summary.failureRate).toBeCloseTo(6 / 128);
    expect(summary.cost).toBeCloseTo(1.5042);
  });

  it("keeps rates and cost null when nothing was decided, rated, finished or priced", () => {
    const summary = summarizeMetrics([NULL_ROW]);
    expect(summary).toMatchObject({
      acceptanceRate: null,
      positiveShare: null,
      failureRate: null,
      cost: null,
    });
  });
});

describe("SummaryTiles", () => {
  it("formats the period's figures in French", () => {
    withIntl(<SummaryTiles summary={summarizeMetrics([metrics(), ROLLOUT_ROW])} days={30} />);
    const section = screen.getByRole("region", { name: "Sur les 30 derniers jours" });
    const tiles = within(section).getAllByRole("listitem");
    expect(tiles[0]).toHaveTextContent("Générations13212 via un déploiement progressif");
    expect(tiles[1]).toHaveTextContent("Taux d'acceptation72,7 %Sur 44 brouillons acceptés ou rejetés");
    expect(tiles[2]).toHaveTextContent("Avis positifs66,7 %Sur 24 avis");
    expect(tiles[3]).toHaveTextContent("Coût estimé1,50 $USEn dollars US");
    expect(tiles[4]).toHaveTextContent("Taux d'échec4,7 %6 échecs sur 128 générations terminées");
  });

  it("says when prices aren't configured and when nothing is known yet", () => {
    withIntl(<SummaryTiles summary={summarizeMetrics([NULL_ROW])} days={7} />);
    const tiles = screen.getAllByRole("listitem");
    expect(tiles[1]).toHaveTextContent("n.d.");
    expect(tiles[1]).toHaveTextContent("Aucun brouillon accepté ou rejeté");
    expect(tiles[3]).toHaveTextContent("Prix non configurés");
    expect(tiles[4]).toHaveTextContent("Aucune génération terminée");
  });
});

describe("MetricsTable", () => {
  it("shows every metric of a row, formatted", () => {
    withIntl(<MetricsTable rows={[metrics(), ROLLOUT_ROW]} workspaceId={WORKSPACE_ID} />);
    const table = screen.getByRole("table", {
      name: "Chiffres de la période par version de modèle de prompt et par modèle d'IA",
    });
    const [, first, second] = within(table).getAllByRole("row");
    if (!first || !second) throw new Error("missing rows");

    const link = within(first).getByRole("link", { name: "Synthèse de section v2" });
    expect(link).toHaveAttribute("href", `/fr/espaces/${WORKSPACE_ID}/modeles/${GLOBAL_VERSION}`);
    expect(first).toHaveTextContent("Global");
    expect(first).toHaveTextContent("claude-sonnet-5-5");
    expect(first).toHaveTextContent("120");
    expect(first).toHaveTextContent("75 %30 sur 40");
    // A mean rating of 0.5 is three thumbs up out of four.
    expect(first).toHaveTextContent("75 %20 avis");
    expect(first).toHaveTextContent("12,5 %");
    expect(first).toHaveTextContent("1 234 567 / 98 7651 333 332 au total");
    expect(first).toHaveTextContent("0,0042 $US");
    expect(first).toHaveTextContent("1,2 s / 3,5 s");
    expect(first).toHaveTextContent("5,2 %6 sur 116");
    expect(within(first).queryByText(/via déploiement/)).toBeNull();

    expect(second).toHaveTextContent("Espace");
    expect(within(second).getByText("12 via déploiement")).toHaveAttribute(
      "title",
      "12 générations servies par un déploiement progressif",
    );
    expect(second).toHaveTextContent("25 %4 avis");
    expect(second).toHaveTextContent("1,50 $US");
  });

  it("shows n.d. for unknown figures and the missing prices", () => {
    withIntl(<MetricsTable rows={[NULL_ROW]} workspaceId={WORKSPACE_ID} />);
    const [, row] = screen.getAllByRole("row");
    if (!row) throw new Error("missing row");
    expect(within(row).queryByRole("link")).toBeNull();
    expect(row).toHaveTextContent("Modèle supprimé");
    expect(row).toHaveTextContent("Prix non configurés");
    // Acceptance, rating, edit ratio, latency and failure rate.
    expect(within(row).getAllByText("Pas de donnée sur la période")).toHaveLength(5);
  });
});

describe("EmptyMetrics", () => {
  it("says the period has no generation", () => {
    withIntl(<EmptyMetrics days={7} />);
    expect(screen.getByRole("heading", { name: "Aucune génération" })).toBeVisible();
    expect(screen.getByText(/sur les 7 derniers jours/)).toBeVisible();
  });
});

describe("PeriodSwitch", () => {
  it("links to each period and marks the current one", () => {
    withIntl(<PeriodSwitch periods={[7, 30, 90]} current={30} workspaceId={WORKSPACE_ID} />);
    const nav = screen.getByRole("navigation", { name: "Période" });
    expect(within(nav).getByRole("link", { name: "7 jours" })).toHaveAttribute(
      "href",
      `/fr/espaces/${WORKSPACE_ID}/ia?periode=7`,
    );
    expect(within(nav).getByRole("link", { name: "30 jours" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "90 jours" })).not.toHaveAttribute("aria-current");
  });
});

describe("RecentGenerations", () => {
  function generation(overrides: Partial<RecentGeneration> = {}): RecentGeneration {
    return {
      id: crypto.randomUUID(),
      createdAt: "2026-10-13T08:30:00.000000+00:00",
      status: "succeeded",
      errorCode: null,
      model: "claude-sonnet-5-5",
      promptVersionId: WORKSPACE_VERSION,
      promptTitle: "Résumé pour le client",
      promptVersion: 4,
      fromRollout: true,
      latencyMs: 2100,
      totalTokens: 15_300,
      cost: 0.012,
      traceUrl: "https://traces.example.com/trace/abc",
      ...overrides,
    };
  }

  it("lists the generations with their figures and a trace link in a new tab", () => {
    withIntl(
      <RecentGenerations
        generations={[
          generation(),
          generation({ status: "failed", errorCode: "timeout", traceUrl: null, fromRollout: false }),
          generation({ status: "failed", errorCode: "somethingNew", cost: null, latencyMs: null }),
        ]}
        workspaceId={WORKSPACE_ID}
        tracingLinks
      />,
    );
    const [first, second, third] = screen.getAllByRole("listitem");
    if (!first || !second || !third) throw new Error("missing items");

    expect(first).toHaveTextContent("Réussie");
    expect(within(first).getByRole("link", { name: "Résumé pour le client v4" })).toHaveAttribute(
      "href",
      `/fr/espaces/${WORKSPACE_ID}/modeles/${WORKSPACE_VERSION}`,
    );
    expect(first).toHaveTextContent("Déploiement");
    expect(first).toHaveTextContent("2,1 s");
    expect(first).toHaveTextContent("15 300 jetons");
    expect(first).toHaveTextContent("0,012 $US");
    const trace = within(first).getByRole("link", { name: /^Voir la trace/ });
    expect(trace).toHaveAttribute("href", "https://traces.example.com/trace/abc");
    expect(trace).toHaveAttribute("target", "_blank");
    expect(trace).toHaveAttribute("rel", "noopener noreferrer");

    expect(second).toHaveTextContent("Échouée");
    expect(second).toHaveTextContent("L'IA a mis trop de temps à répondre.");
    expect(second).not.toHaveTextContent("Déploiement");
    expect(within(second).queryByRole("link", { name: /Voir la trace/ })).toBeNull();

    expect(third).toHaveTextContent("Erreur somethingNew.");
    expect(screen.queryByText(/apparaissent une fois le traçage/)).toBeNull();
  });

  it("explains the missing trace links when tracing isn't configured", () => {
    withIntl(
      <RecentGenerations
        generations={[generation({ traceUrl: null })]}
        workspaceId={WORKSPACE_ID}
        tracingLinks={false}
      />,
    );
    expect(screen.getByText(/apparaissent une fois le traçage des générations configuré/)).toBeVisible();
  });

  it("has an empty state", () => {
    withIntl(<RecentGenerations generations={[]} workspaceId={WORKSPACE_ID} tracingLinks />);
    expect(screen.getByText("Aucune génération pour le moment.")).toBeVisible();
  });
});
