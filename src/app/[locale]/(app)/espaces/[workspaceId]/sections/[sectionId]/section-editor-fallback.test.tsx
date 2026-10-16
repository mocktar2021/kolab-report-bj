import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../../messages/fr.json";
import { SectionEditor } from "./section-editor";

vi.mock("./content-actions", () => ({ saveSectionContent: vi.fn() }));
// The Texte editor fails, as when its code can't load.
vi.mock("./rich-text-editor", () => ({
  RichTextEditor: () => {
    throw new Error("Loading chunk failed");
  },
}));

describe("SectionEditor when the Texte editor fails", () => {
  it("keeps the text and offers the Markdown tab", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
        <SectionEditor
          sectionId="6f1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b"
          content="Texte gardé."
          version="v1"
          draftHint={false}
        />
      </NextIntlClientProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Modifier le texte" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("L'éditeur Texte n'a pas pu s'afficher.");

    await user.click(screen.getByRole("button", { name: "Ouvrir l'onglet Markdown" }));
    expect(screen.getByRole("tab", { name: "Markdown" })).toHaveFocus();
    expect(screen.getByLabelText("Texte de la section (Markdown)")).toHaveValue("Texte gardé.");
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeVisible();
  });
});
