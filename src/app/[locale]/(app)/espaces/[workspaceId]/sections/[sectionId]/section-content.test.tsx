import { render, screen } from "@testing-library/react";
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

describe("SectionContent", () => {
  it("shows an empty state, with a hint for editors who can ask for a draft", () => {
    const { rerender } = renderContent(null, true);
    expect(screen.getByRole("heading", { level: 2, name: "Contenu de la section" })).toBeVisible();
    expect(screen.getByText("Aucun contenu pour l'instant.")).toBeVisible();
    expect(screen.getByText(/Générez un brouillon ci-dessous/)).toBeVisible();

    rerender(
      <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
        <SectionContent content={"  \n"} draftHint={false} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Aucun contenu pour l'instant.")).toBeVisible();
    expect(screen.queryByText(/Générez un brouillon ci-dessous/)).toBeNull();
  });

  it("renders Markdown with tables, links as text, and no images or raw HTML", () => {
    const { container } = renderContent(
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
    renderContent("# Un\n\n## Deux\n\n### Trois\n\n#### Quatre");
    expect(screen.getByRole("heading", { name: "Un" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { name: "Deux" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { name: "Trois" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { name: "Quatre" }).tagName).toBe("H4");
  });
});
