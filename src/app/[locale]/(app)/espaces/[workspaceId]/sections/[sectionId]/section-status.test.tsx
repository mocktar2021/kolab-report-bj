import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../../messages/fr.json";
import { updateSectionStatus } from "./actions";
import { SectionStatusControl } from "./section-status";

vi.mock("./actions", () => ({ updateSectionStatus: vi.fn() }));

const SECTION_ID = "11111111-1111-4111-8111-111111111111";

function renderControl() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <SectionStatusControl sectionId={SECTION_ID} status="in_progress" />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  vi.mocked(updateSectionStatus).mockReset();
});

describe("SectionStatusControl", () => {
  it("says the report is final when the change is refused for that reason", async () => {
    vi.mocked(updateSectionStatus).mockResolvedValue({ ok: false, error: "reportFinal" });
    renderControl();

    fireEvent.change(screen.getByLabelText("Statut de la section"), { target: { value: "completed" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ce rapport est final. Un propriétaire doit le rouvrir pour le modifier.",
    );
    expect(updateSectionStatus).toHaveBeenCalledWith(SECTION_ID, "completed");
  });

  it("keeps the generic message for other failures", async () => {
    vi.mocked(updateSectionStatus).mockResolvedValue({ ok: false });
    renderControl();

    fireEvent.change(screen.getByLabelText("Statut de la section"), { target: { value: "completed" } });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Le statut n'a pas pu être enregistré. Réessayez."),
    );
  });
});
