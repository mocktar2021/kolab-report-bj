import { render, screen } from "@testing-library/react";
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
});
