import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type { TemplateWriterUsage as Usage } from "@/lib/ai/metrics-server";
import messages from "../../../../../../../messages/fr.json";
import { TemplateWriterUsage } from "./template-writer-usage";

const ROW: Usage = {
  model: "claude-haiku-5-5",
  calls: 12,
  succeeded: 11,
  failed: 1,
  inputTokens: 18_400,
  outputTokens: 9_100,
  cost: 0.0412,
  lastCall: "2026-10-16T09:00:00Z",
};

function renderUsage(rows: Usage[]) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <TemplateWriterUsage rows={rows} days={30} />
    </NextIntlClientProvider>,
  );
}

describe("TemplateWriterUsage", () => {
  it("shows the calls, failures, tokens and cost of each model", () => {
    renderUsage([ROW, { ...ROW, model: "mock", calls: 1, failed: 0, cost: null }]);
    const section = screen.getByRole("region", { name: "Modèles rédigés avec l'IA" });
    expect(within(section).getByText(/sur les 30 derniers jours/)).toBeInTheDocument();
    const [first, second] = within(section).getAllByRole("listitem");
    expect(first).toHaveTextContent("claude-haiku-5-5");
    expect(first).toHaveTextContent("12 appels");
    expect(first).toHaveTextContent("1 échec");
    expect(first).toHaveTextContent(/18\s400 jetons en entrée, 9\s100 en sortie/);
    expect(first).toHaveTextContent(/Coût estimé : 0,0412\s\$US/);
    expect(second).toHaveTextContent("1 appel");
    expect(second).toHaveTextContent("aucun échec");
    expect(second).toHaveTextContent("Coût : prix non configurés");
  });

  it("says when nothing was written with the AI", () => {
    renderUsage([]);
    expect(screen.getByText("Aucun modèle rédigé avec l'IA sur la période.")).toBeInTheDocument();
  });
});
