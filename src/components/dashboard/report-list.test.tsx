import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceReport } from "@/lib/dashboard";
import messages from "../../../messages/fr.json";
import { ReportList } from "./report-list";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode; className?: string }) => (
    <a href={`/fr${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const AUDIT_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";
const EMPTY_ID = "4d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a";

const AUDIT: WorkspaceReport = {
  id: AUDIT_ID,
  title: "Audit énergétique du siège",
  status: "in_review",
  totalSections: 6,
  counts: { not_started: 2, in_progress: 1, completed: 3 },
  completionPercent: 62.5,
  assignees: [
    {
      userId: "aaaaaaaa-1111-4111-8111-111111111111",
      name: "Fatou Dossou",
      counts: { not_started: 0, in_progress: 1, completed: 2 },
      total: 3,
      completionPercent: 83.3,
    },
    {
      userId: "cccccccc-3333-4333-8333-333333333333",
      name: null,
      counts: { not_started: 1, in_progress: 0, completed: 1 },
      total: 2,
      completionPercent: 50,
    },
    {
      userId: null,
      name: null,
      counts: { not_started: 1, in_progress: 0, completed: 0 },
      total: 1,
      completionPercent: 0,
    },
  ],
};

const EMPTY: WorkspaceReport = {
  id: EMPTY_ID,
  title: "Rapport vide",
  status: "draft",
  totalSections: 0,
  counts: { not_started: 0, in_progress: 0, completed: 0 },
  completionPercent: 0,
  assignees: [],
};

function renderList(reports: WorkspaceReport[]) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <ReportList reports={reports} />
    </NextIntlClientProvider>,
  );
}

function card(title: string) {
  const item = screen.getByRole("heading", { level: 3, name: title }).closest("li");
  if (!item) throw new Error(`no card for ${title}`);
  return within(item);
}

describe("ReportList", () => {
  it("shows one card per report with a link, the percent and the counts", () => {
    renderList([AUDIT, EMPTY]);

    expect(screen.getByRole("heading", { level: 2, name: "Rapports" })).toBeInTheDocument();
    expect(screen.getByText("2 rapports")).toBeInTheDocument();

    const audit = card("Audit énergétique du siège");
    expect(audit.getByRole("link", { name: "Audit énergétique du siège" })).toHaveAttribute(
      "href",
      `/fr/rapports/${AUDIT_ID}`,
    );
    expect(audit.getByText("6 sections")).toBeInTheDocument();
    // 62.5 from the view, shown as a whole percent.
    expect(audit.getByText(/^63\s%$/)).toBeInTheDocument();

    const counts = audit.getByRole("list", { name: "Sections par statut" });
    expect(
      within(counts)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["2 non commencées", "1 en cours", "3 terminées"]);
  });

  it("shows the status of each report as a badge", () => {
    renderList([AUDIT, EMPTY]);

    expect(card("Audit énergétique du siège").getByText("En revue")).toBeInTheDocument();
    expect(card("Rapport vide").getByText("Brouillon")).toBeInTheDocument();
  });

  it("marks a final report with its own badge", () => {
    renderList([{ ...AUDIT, status: "final" }]);

    const badge = card("Audit énergétique du siège").getByText("Final");
    expect(badge).toHaveAttribute("data-status", "final");
    // A lock next to the word, not color alone.
    expect(badge.querySelector("svg")).not.toBeNull();
  });

  it("gives each report a labelled progress bar", () => {
    renderList([AUDIT, EMPTY]);

    const bar = screen.getByRole("progressbar", { name: "Avancement du rapport Audit énergétique du siège" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuenow", "62.5");
    expect(bar.getAttribute("aria-valuetext")).toMatch(/^63\s%$/);
    expect(bar.firstElementChild).toHaveStyle({ width: "62.5%" });

    expect(screen.getByRole("progressbar", { name: "Avancement du rapport Rapport vide" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  });

  it("uses the singular for one section", () => {
    renderList([{ ...AUDIT, counts: { not_started: 1, in_progress: 0, completed: 1 }, totalSections: 2 }]);

    const counts = card("Audit énergétique du siège").getByRole("list", { name: "Sections par statut" });
    expect(
      within(counts)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["1 non commencée", "0 en cours", "1 terminée"]);
  });

  it("lists the experts under a closed Par expert disclosure", () => {
    const { container } = renderList([AUDIT]);

    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    const summary = within(details as HTMLElement).getByText("Par expert", { exact: false });
    expect(summary.textContent).toBe("Par expert pour Audit énergétique du siège");

    // Initials, name, percent, then the completed sections.
    const rows = within(details as HTMLElement).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^FDFatou Dossou83\s%2 sur 3 terminées$/),
      expect.stringMatching(/^Membre inconnu50\s%1 sur 2 terminée$/),
      expect.stringMatching(/^Non attribuée0\s%0 sur 1 terminée$/),
    ]);
  });

  it("shows an empty state for a report without sections", () => {
    renderList([EMPTY]);

    const empty = card("Rapport vide");
    expect(empty.getByText("Aucune section")).toBeInTheDocument();
    expect(
      empty.getByText("Aucune section pour le moment. Les sections ajoutées au rapport apparaissent ici."),
    ).toBeInTheDocument();
    expect(empty.getByText(/^0\s%$/)).toBeInTheDocument();
    expect(empty.queryByRole("list", { name: "Sections par statut" })).not.toBeInTheDocument();
    expect(empty.queryByText("Par expert", { exact: false })).not.toBeInTheDocument();
  });

  it("says when the workspace has no report", () => {
    renderList([]);

    expect(screen.getByText("Aucun rapport")).toBeInTheDocument();
    expect(screen.getByText("Aucun rapport dans cet espace de travail pour le moment.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
