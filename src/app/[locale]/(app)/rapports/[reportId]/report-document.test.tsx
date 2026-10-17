import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/fr.json";
import { ReportDocument, type ReportSection } from "./report-document";

const drawn = vi.hoisted(() => [] as string[]);

vi.mock("@/components/markdown", () => ({
  Markdown: ({ children }: { children: string }) => {
    drawn.push(children);
    return <div>{children}</div>;
  },
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode; className?: string }) => (
    <a href={`/fr${href}`} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("./actions", () => ({
  reorderSections: vi.fn(),
  addSection: vi.fn(),
  updateSectionAssignment: vi.fn(),
}));

const WORKSPACE_ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";

function section(id: string, title: string, content: string, label = "1."): ReportSection {
  return {
    id,
    title,
    label,
    level: 1,
    parentId: null,
    status: "in_progress",
    weight: 1,
    assignedTo: null,
    assigneeName: null,
    mine: false,
    canEdit: true,
    content,
  };
}

const SECTIONS = [
  section("11111111-1111-4111-8111-111111111111", "Contexte", "Texte du contexte"),
  section("22222222-2222-4222-8222-222222222222", "Analyse", "Texte de l'analyse", "2."),
  section("33333333-3333-4333-8333-333333333333", "Annexes", "Texte des annexes", "3."),
];

function documentOf(sections: ReportSection[], open = true, onOpenChange = () => {}) {
  return (
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <ReportDocument
        workspaceId={WORKSPACE_ID}
        sections={sections}
        open={open}
        onOpenChange={onOpenChange}
      />
    </NextIntlClientProvider>
  );
}

describe("ReportDocument", () => {
  beforeEach(() => {
    drawn.length = 0;
  });

  it("shows the text with Aperçu and hides it again", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(documentOf(SECTIONS, false, onOpenChange));
    expect(screen.getByRole("heading", { level: 2, name: "Texte du rapport" })).toBeVisible();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(drawn).toEqual([]);

    const show = screen.getByRole("button", { name: "Aperçu du texte du rapport" });
    expect(show).toHaveTextContent("Aperçu");
    expect(show).toHaveAttribute("aria-expanded", "false");
    const body = document.getElementById(show.getAttribute("aria-controls") ?? "");
    expect(body).not.toBeNull();
    expect(body).not.toBeVisible();
    fireEvent.click(show);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    rerender(documentOf(SECTIONS, true, onOpenChange));
    const hide = screen.getByRole("button", { name: "Masquer l'aperçu du texte du rapport" });
    expect(hide).toHaveTextContent("Masquer l'aperçu");
    expect(hide).toHaveAttribute("aria-expanded", "true");
    expect(body).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "1. Contexte",
      "2. Analyse",
      "3. Annexes",
    ]);
    fireEvent.click(hide);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("draws again only the sections a refresh changed", () => {
    const { rerender } = render(documentOf(SECTIONS));
    expect(drawn).toEqual(["Texte du contexte", "Texte de l'analyse", "Texte des annexes"]);

    // router.refresh() brings new objects, here with one new text and one new title.
    drawn.length = 0;
    rerender(
      documentOf(
        SECTIONS.map((value, index) =>
          index === 1
            ? { ...value, content: "Texte revu" }
            : index === 2
              ? { ...value, title: "Annexe" }
              : { ...value },
        ),
      ),
    );
    expect(drawn).toEqual(["Texte revu", "Texte des annexes"]);
    expect(screen.getByRole("heading", { level: 3, name: /Annexe$/ })).toBeInTheDocument();

    // Back to the first values: the first section never changed.
    drawn.length = 0;
    rerender(documentOf(SECTIONS.map((value) => ({ ...value }))));
    expect(drawn).toEqual(["Texte de l'analyse", "Texte des annexes"]);
  });
});
