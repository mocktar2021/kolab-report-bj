import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../../../../../messages/fr.json";
import { SectionContent } from "./section-content";

function renderContent(content: string | null, draftHint = false) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <SectionContent content={content} draftHint={draftHint} />
    </NextIntlClientProvider>,
  );
}

/** The text shows with "Aperçu" (KRB-201). */
function renderShown(content: string) {
  const result = renderContent(content);
  fireEvent.click(screen.getByRole("button", { name: "Aperçu du contenu de la section" }));
  return result;
}

describe("SectionContent", () => {
  it("hides the text until Aperçu, and hides it again", () => {
    renderContent("Texte de la section");
    expect(screen.getByRole("heading", { level: 2, name: "Contenu de la section" })).toBeVisible();
    expect(screen.queryByText("Texte de la section")).toBeNull();

    const show = screen.getByRole("button", { name: "Aperçu du contenu de la section" });
    expect(show).toHaveTextContent("Aperçu");
    expect(show).toHaveAttribute("aria-expanded", "false");
    const body = document.getElementById(show.getAttribute("aria-controls") ?? "");
    expect(body).not.toBeVisible();

    fireEvent.click(show);
    const hide = screen.getByRole("button", { name: "Masquer l'aperçu du contenu de la section" });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    expect(body).toBeVisible();
    expect(screen.getByText("Texte de la section")).toBeVisible();

    fireEvent.click(hide);
    expect(screen.queryByText("Texte de la section")).toBeNull();
    expect(screen.getByRole("button", { name: "Aperçu du contenu de la section" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("shows the text when its title takes the focus, after a save or an accepted draft", () => {
    renderContent("Texte accepté");
    act(() => document.getElementById("section-content-title")?.focus());
    expect(screen.getByText("Texte accepté")).toBeVisible();
    expect(screen.getByRole("button", { name: "Masquer l'aperçu du contenu de la section" })).toBeVisible();
  });

  it("has no Aperçu while the editor takes the place of the text", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
        <SectionContent content="Texte" draftHint={false} actions={<button type="button">Modifier</button>}>
          <p>Éditeur</p>
        </SectionContent>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Éditeur")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Aperçu/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Modifier" })).toBeVisible();
  });

  it("shows an empty state, with a hint for editors who can ask for a draft", () => {
    const { rerender } = renderContent(null, true);
    expect(screen.getByRole("heading", { level: 2, name: "Contenu de la section" })).toBeVisible();
    expect(screen.getByText("Aucun contenu pour l'instant.")).toBeVisible();
    expect(screen.getByText(/Générez un brouillon ci-dessous/)).toBeVisible();
    // Nothing to show or hide.
    expect(screen.queryByRole("button", { name: /Aperçu/ })).toBeNull();

    rerender(
      <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
        <SectionContent content={"  \n"} draftHint={false} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Aucun contenu pour l'instant.")).toBeVisible();
    expect(screen.queryByText(/Générez un brouillon ci-dessous/)).toBeNull();
  });

  it("renders Markdown with tables, links as text, and no images or raw HTML", () => {
    const { container } = renderShown(
      [
        "### Contexte",
        "",
        "Voir [le site](https://example.com) et [ce lien](javascript:alert(1)).",
        "",
        "![schéma](https://example.com/a.png)",
        "",
        '<b>gras</b> <img src="x" onerror="alert(1)">',
        "",
        "| Bâtiment | kWh |",
        "| --- | --- |",
        "| Siège | 1 092 000 |",
      ].join("\n"),
    );

    expect(screen.getByRole("heading", { level: 3, name: "Contexte" })).toBeVisible();
    // The text may come from the model: a link shows its address and can't be clicked.
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(container.textContent).toContain("le site (https://example.com)");
    expect(container.textContent).not.toMatch(/javascript/i);
    expect(screen.getByRole("table")).toHaveTextContent("Siège");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("puts the top Markdown headings under the block's title", () => {
    renderShown("# Un\n\n## Deux\n\n### Trois\n\n#### Quatre");
    expect(screen.getByRole("heading", { name: "Un" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { name: "Deux" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { name: "Trois" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { name: "Quatre" }).tagName).toBe("H4");
  });
});
