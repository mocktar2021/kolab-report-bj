import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/fr.json";
import { ReportTitle } from "./report-title";
import { renameReport } from "./title-actions";

vi.mock("./title-actions", () => ({ renameReport: vi.fn() }));

const REPORT_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";
const TITLE = "Audit énergétique du siège";

function renderTitle(canRename = true) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <ReportTitle reportId={REPORT_ID} title={TITLE} canRename={canRename} />
    </NextIntlClientProvider>,
  );
}

async function openForm() {
  const user = userEvent.setup();
  renderTitle();
  const opener = screen.getByRole("button", { name: "Renommer le rapport" });
  await user.click(opener);
  return { user, opener, field: screen.getByLabelText("Titre du rapport") };
}

/** What the form sent to the server action, as a plain object. */
function sent() {
  const formData = vi.mocked(renameReport).mock.calls[0]?.[1];
  return formData ? Object.fromEntries(formData.entries()) : null;
}

afterEach(() => {
  vi.mocked(renameReport).mockReset();
});

describe("ReportTitle", () => {
  it("shows only the title to people who may not rename the report", () => {
    renderTitle(false);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TITLE);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("opens on a labelled field with the current title", async () => {
    const { field } = await openForm();

    expect(field).toHaveFocus();
    expect(field).toHaveValue(TITLE);
    expect(field).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Renommer le rapport" })).not.toBeInTheDocument();
  });

  it("closes on Escape without saving and gives the focus back to the button", async () => {
    const { user } = await openForm();

    await user.type(screen.getByLabelText("Titre du rapport"), " modifié");
    await user.keyboard("{Escape}");

    expect(screen.queryByLabelText("Titre du rapport")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Renommer le rapport" })).toHaveFocus();
    expect(renameReport).not.toHaveBeenCalled();

    // The next opening starts again from the saved title.
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Titre du rapport")).toHaveValue(TITLE);
  });

  it("closes on Annuler, and on an unchanged title, without calling the server", async () => {
    const { user } = await openForm();
    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.getByRole("button", { name: "Renommer le rapport" })).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(screen.queryByLabelText("Titre du rapport")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Renommer le rapport" })).toHaveFocus();
    expect(renameReport).not.toHaveBeenCalled();
  });

  it("ties a title the server refuses to the field, with the message of Nouveau rapport", async () => {
    vi.mocked(renameReport).mockResolvedValue({ status: "error", fieldErrors: { title: "titleLength" } });
    const { user, field } = await openForm();

    await user.clear(field);
    await user.type(field, " a ");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Saisissez entre 2 et 200 caractères.")).toBeVisible();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Saisissez entre 2 et 200 caractères.");
    expect(field).toHaveFocus();
    expect(sent()).toEqual({ reportId: REPORT_ID, title: " a " });
  });

  it("keeps the field open with the reason when the server refuses the change", async () => {
    vi.mocked(renameReport).mockResolvedValue({ status: "error", error: "billingReadOnly" });
    const { user, field } = await openForm();

    await user.type(field, " 2026");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cet espace de travail est en lecture seule : l'offre de l'organisation n'est plus active.",
    );
    expect(field).toHaveValue(`${TITLE} 2026`);
  });

  it("announces the save and gives the focus back to the button", async () => {
    vi.mocked(renameReport).mockResolvedValue({ status: "success" });
    const { user, field } = await openForm();

    await user.clear(field);
    await user.type(field, "Bilan de mission 2026{Enter}");

    // The status region is always there: wait for the message, not the region.
    await screen.findByText("Titre enregistré.");
    expect(screen.getByRole("status")).toHaveTextContent("Titre enregistré.");
    expect(screen.queryByLabelText("Titre du rapport")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Renommer le rapport" })).toHaveFocus();
    expect(sent()).toEqual({ reportId: REPORT_ID, title: "Bilan de mission 2026" });

    // Opening the form again clears the message.
    await user.keyboard("{Enter}");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
