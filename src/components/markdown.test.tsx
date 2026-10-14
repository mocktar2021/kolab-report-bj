import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

const TEXT =
  "Voir [le rapport](https://exemple.org/rapport) et https://exemple.org/annexe.\n\n![pixel](https://exemple.org/p.png)";

describe("Markdown", () => {
  it("opens links in a new tab without sending the page address", () => {
    render(<Markdown fallback={null}>{TEXT}</Markdown>);
    const link = screen.getByRole("link", { name: "le rapport" });
    expect(link).toHaveAttribute("href", "https://exemple.org/rapport");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });

  it("shows links as text with their address when asked", () => {
    const { container } = render(
      <Markdown fallback={null} links="text">
        {TEXT}
      </Markdown>,
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(container.textContent).toContain("le rapport (https://exemple.org/rapport)");
    // A bare address is shown once.
    expect(container.textContent).toContain("et https://exemple.org/annexe.");
    expect(container.textContent).not.toContain("https://exemple.org/annexe (");
  });

  it("never renders images or raw HTML", () => {
    const { container } = render(
      <Markdown fallback={null}>{`${TEXT}\n\n<img src="x" onerror="alert(1)"><b>gras</b>`}</Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("shows text that would take the parser seconds as plain text, quickly", () => {
    // About two minutes each without the check (KRB-18).
    for (const text of ["a\n=\n".repeat(25_000), "*a_".repeat(33_000)]) {
      const started = performance.now();
      const html = renderToString(
        <Markdown fallback={null} headingLevel={4} headings="flatten" links="text">
          {text}
        </Markdown>,
      );
      expect(performance.now() - started).toBeLessThan(1_000);
      expect(html.startsWith('<div class="whitespace-pre-wrap break-words">')).toBe(true);
      expect(html).not.toMatch(/<(?:h\d|p|em|strong)\b/);
    }
    const { container } = render(<Markdown fallback={null}>{"> a\n\n".repeat(20_000)}</Markdown>);
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.textContent).toBe("> a\n\n".repeat(20_000));
  });

  it("still renders a few setext headings", () => {
    render(<Markdown fallback={null}>{"Titre\n=====\n\nTexte"}</Markdown>);
    expect(screen.getByRole("heading", { level: 3, name: "Titre" })).toBeInTheDocument();
  });
});
