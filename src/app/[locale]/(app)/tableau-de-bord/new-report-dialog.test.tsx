import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/fr.json";
import { createReport, reportUsageHint } from "./actions";
import { NewReportDialog } from "./new-report-dialog";

vi.mock("./actions", () => ({ createReport: vi.fn(), reportUsageHint: vi.fn() }));

beforeEach(() => {
  // No plan limit unless a test says otherwise.
  vi.mocked(reportUsageHint).mockResolvedValue(null);
});

const WORKSPACE_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";

function renderDialog() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <NewReportDialog workspaceId={WORKSPACE_ID} workspaceName="Audit énergétique 2026" />
    </NextIntlClientProvider>,
  );
}

async function openDialog() {
  const user = userEvent.setup();
  renderDialog();
  const opener = screen.getByRole("button", { name: "Nouveau rapport" });
  await user.click(opener);
  const dialog = await screen.findByRole("dialog", { name: "Nouveau rapport" });
  return { user, opener, dialog };
}

afterEach(() => {
  vi.mocked(createReport).mockReset();
});

describe("NewReportDialog", () => {
  it("opens on the title field and names the workspace", async () => {
    const { dialog } = await openDialog();

    expect(dialog).toHaveAccessibleDescription(/l'espace de travail Audit énergétique 2026/);
    expect(screen.getByLabelText("Titre du rapport")).toHaveFocus();
  });

  it("ties a title that is too short to the field and does not call the server", async () => {
    const { user } = await openDialog();

    await user.type(screen.getByLabelText("Titre du rapport"), " a ");
    await user.click(screen.getByRole("button", { name: "Créer le rapport" }));

    const field = screen.getByLabelText("Titre du rapport");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Saisissez entre 2 et 200 caractères.");
    expect(field).toHaveFocus();
    expect(createReport).not.toHaveBeenCalled();
  });

  it("sends the workspace and the title, and keeps the title when the server refuses", async () => {
    vi.mocked(createReport).mockResolvedValue({ status: "error", formError: "forbidden" });
    const { user } = await openDialog();

    await user.type(screen.getByLabelText("Titre du rapport"), "Rapport de fin de mission");
    await user.click(screen.getByRole("button", { name: "Créer le rapport" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vous n'avez pas les droits pour faire ce changement.",
    );
    expect(createReport).toHaveBeenCalledWith(WORKSPACE_ID, "Rapport de fin de mission");
    expect(screen.getByLabelText("Titre du rapport")).toHaveValue("Rapport de fin de mission");
  });

  it("shows the plan's active reports once the dialog is open", async () => {
    vi.mocked(reportUsageHint).mockResolvedValue(
      "Offre Indépendant : 2 rapports actifs sur 3. Un rapport final ne compte plus.",
    );
    renderDialog();
    expect(reportUsageHint).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole("button", { name: "Nouveau rapport" }));
    const dialog = await screen.findByRole("dialog", { name: "Nouveau rapport" });
    expect(
      await within(dialog).findByText(
        "Offre Indépendant : 2 rapports actifs sur 3. Un rapport final ne compte plus.",
      ),
    ).toBeVisible();
    expect(reportUsageHint).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it("gives the focus back to the button on cancel, and starts empty the next time", async () => {
    const { user, opener } = await openDialog();

    await user.type(screen.getByLabelText("Titre du rapport"), "Brouillon");
    await user.click(screen.getByRole("button", { name: "Annuler" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Titre du rapport")).toHaveValue("");
  });
});
