import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
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

function section(id: string, title: string, content: string): ReportSection {
  return {
    id,
    title,
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
  section("22222222-2222-4222-8222-222222222222", "Analyse", "Texte de l'analyse"),
  section("33333333-3333-4333-8333-333333333333", "Annexes", "Texte des annexes"),
];

function documentOf(sections: ReportSection[]) {
  return (
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <ReportDocument workspaceId={WORKSPACE_ID} sections={sections} />
    </NextIntlClientProvider>
  );
}

describe("ReportDocument", () => {
  beforeEach(() => {
    drawn.length = 0;
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
