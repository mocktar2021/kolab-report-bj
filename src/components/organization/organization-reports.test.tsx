import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/fr.json";
import type { OrganizationReports } from "@/lib/reports/organization";
import { OrganizationReportList } from "./organization-reports";

const selectWorkspace = vi.fn();
vi.mock("@/lib/workspaces/actions", () => ({
  selectWorkspace: (id: string) => selectWorkspace(id),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const DATA: OrganizationReports = {
  total: 2,
  active: 1,
  workspaces: [
    {
      workspace: {
        id: "w-1",
        name: "Cartographie des risques",
        organizationId: "o-houeze",
        organizationName: "Cabinet Houeze",
        ownsOrganization: true,
        role: "owner",
      },
      reports: [
        {
          id: "r-1",
          title: "Rapport de cartographie",
          status: "in_review",
          totalSections: 12,
          completionPercent: 41.5,
          createdAt: "2026-10-01T09:00:00Z",
        },
        {
          id: "r-2",
          title: "Rapport 2025",
          status: "final",
          totalSections: 1,
          completionPercent: 100,
          createdAt: "2026-01-01T09:00:00Z",
        },
      ],
    },
    {
      workspace: {
        id: "w-2",
        name: "Test",
        organizationId: "o-houeze",
        organizationName: "Cabinet Houeze",
        ownsOrganization: true,
        role: "expert",
      },
      reports: [],
    },
  ],
};

beforeEach(() => selectWorkspace.mockReset());

function renderList() {
  render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <OrganizationReportList data={DATA} />
    </NextIntlClientProvider>,
  );
}

describe("OrganizationReportList (KRB-208)", () => {
  it("shows a block per workspace, with its role and its report count", () => {
    renderList();
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Cartographie des risques",
      "Test",
    ]);
    const cartographie = screen.getByRole("region", { name: "Cartographie des risques" });
    expect(within(cartographie).getByText("Propriétaire · 2 rapports")).toBeVisible();
    const test = screen.getByRole("region", { name: "Test" });
    expect(within(test).getByText("Expert · aucun rapport")).toBeVisible();
    expect(within(test).getByText("Aucun rapport dans cet espace de travail pour le moment.")).toBeVisible();
  });

  it("links each report, with its status, its sections and its completion", () => {
    renderList();
    const cartographie = screen.getByRole("region", { name: "Cartographie des risques" });
    const rows = within(cartographie).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole("link", { name: "Rapport de cartographie" })).toHaveAttribute(
      "href",
      "/rapports/r-1",
    );
    expect(within(rows[0]!).getByText("En revue")).toBeVisible();
    expect(within(rows[0]!).getByText("12 sections")).toBeVisible();
    expect(
      within(rows[0]!).getByRole("progressbar", { name: "Avancement du rapport Rapport de cartographie" }),
    ).toHaveAttribute("aria-valuenow", "41.5");
    expect(within(rows[1]!).getByText("Final")).toBeVisible();
  });

  it("opens a workspace with a button named after it", async () => {
    renderList();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Ouvrir l'espace Test" }));
    await waitFor(() => expect(selectWorkspace).toHaveBeenCalledWith("w-2"));
  });
});
