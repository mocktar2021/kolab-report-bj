import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/fr.json";
import { reorderSections, type ReorderResult } from "./actions";
import { MasterReport } from "./master-report";
import type { ReportSection } from "./report-document";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
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

const REPORT_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";
const WORKSPACE_ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";
const ME = "aaaaaaaa-1111-4111-8111-111111111111";
const OTHER = "bbbbbbbb-2222-4222-8222-222222222222";

function section(id: string, title: string, overrides: Partial<ReportSection> = {}): ReportSection {
  return {
    id,
    title,
    status: "not_started",
    weight: 1,
    assignedTo: null,
    assigneeName: null,
    mine: false,
    canEdit: true,
    content: null,
    ...overrides,
  };
}

const CONTEXT = section("11111111-1111-4111-8111-111111111111", "Contexte", {
  status: "completed",
  assignedTo: ME,
  assigneeName: "Fatou Dossou",
  mine: true,
  content:
    "# Objectifs\n\nRéduire la consommation de **12 %**.\n\n### Points clés\n\n[Source](https://example.com/rapport)",
});
const ANALYSIS = section("22222222-2222-4222-8222-222222222222", "Analyse", {
  status: "in_progress",
  assignedTo: OTHER,
  assigneeName: "Eli Expert",
  canEdit: false,
});
const APPENDIX = section("33333333-3333-4333-8333-333333333333", "Annexes", { canEdit: false });
const SECTIONS = [CONTEXT, ANALYSIS, APPENDIX];

function renderReport({
  sections = SECTIONS,
  canManage = true,
}: { sections?: ReportSection[]; canManage?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <MasterReport
        reportId={REPORT_ID}
        workspaceId={WORKSPACE_ID}
        sections={sections}
        assignees={[]}
        canManage={canManage}
      />
    </NextIntlClientProvider>,
  );
}

function toc() {
  return screen.getByRole("region", { name: "Sommaire" });
}

function tocTitles() {
  return within(toc())
    .getAllByRole("listitem")
    .map((item) => within(item).getAllByRole("link")[0]?.textContent);
}

/** The reorder message, in the live region under "Sommaire". */
function reorderStatus() {
  const status = within(toc())
    .getAllByRole("status")
    .find((element) => element.parentElement?.querySelector("#toc-title"));
  if (!status) throw new Error("missing reorder status");
  return status;
}

function documentTitles() {
  const text = screen.getByRole("region", { name: "Texte du rapport" });
  return within(text)
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent);
}

/**
 * jsdom has no layout: each row gets a 60px tall box in DOM order, so the
 * keyboard sensor can find the row above or below.
 */
function mockRowBoxes() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const row = this.closest("li");
    const rows = row?.parentElement ? Array.from(row.parentElement.children) : [];
    const top = row ? rows.indexOf(row) * 60 : 0;
    const height = row ? 60 : 0;
    return {
      x: 0,
      y: top,
      top,
      left: 0,
      width: 600,
      height,
      right: 600,
      bottom: top + height,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

/** Keyboard drag: Space on the handle, arrows, then Space to drop. */
async function moveWithKeyboard(title: string, key: "ArrowUp" | "ArrowDown", times: number) {
  const handle = screen.getByRole("button", { name: `Déplacer la section ${title}` });
  handle.focus();
  // The sensor listens to the document one tick after the drag starts.
  await act(async () => {
    fireEvent.keyDown(handle, { key: " ", code: "Space" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  for (let i = 0; i < times; i++) {
    await act(async () => {
      fireEvent.keyDown(document, { key, code: key });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  await act(async () => {
    fireEvent.keyDown(document, { key: " ", code: "Space" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mockRowBoxes();
});

afterEach(() => {
  vi.mocked(reorderSections).mockReset();
  router.refresh.mockReset();
});

describe("MasterReport for a manager", () => {
  it("lists the sections in order in the table of contents and the text", () => {
    renderReport();
    expect(tocTitles()).toEqual(["Contexte", "Analyse", "Annexes"]);
    expect(documentTitles()).toEqual(["1. Contexte", "2. Analyse", "3. Annexes"]);

    const first = within(toc()).getAllByRole("listitem")[0];
    if (!first) throw new Error("missing row");
    expect(within(first).getByRole("link", { name: "Contexte" })).toHaveAttribute(
      "href",
      `#section-${CONTEXT.id}`,
    );
    expect(first).toHaveTextContent("Terminée");
    expect(first).toHaveTextContent("Votre section");
  });

  it("saves the new full order after a keyboard move", async () => {
    let finish: (result: ReorderResult) => void = () => {};
    vi.mocked(reorderSections).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderReport();

    await moveWithKeyboard("Annexes", "ArrowUp", 2);

    expect(reorderSections).toHaveBeenCalledTimes(1);
    expect(reorderSections).toHaveBeenCalledWith(REPORT_ID, [APPENDIX.id, CONTEXT.id, ANALYSIS.id]);
    // Both lists move right away, and the handles wait for the save.
    expect(tocTitles()).toEqual(["Annexes", "Contexte", "Analyse"]);
    expect(documentTitles()).toEqual(["1. Annexes", "2. Contexte", "3. Analyse"]);
    expect(reorderStatus()).toHaveTextContent("Enregistrement du nouvel ordre…");
    for (const handle of screen.getAllByRole("button", { name: /^Déplacer la section/ })) {
      expect(handle).toHaveAttribute("aria-disabled", "true");
    }

    // A second drag while saving starts nothing.
    await moveWithKeyboard("Analyse", "ArrowUp", 1);
    expect(reorderSections).toHaveBeenCalledTimes(1);

    await act(async () => finish({ ok: true }));
    expect(reorderStatus()).toHaveTextContent("Ordre des sections enregistré.");
    expect(tocTitles()).toEqual(["Annexes", "Contexte", "Analyse"]);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("puts the order back and says so when the save fails", async () => {
    vi.mocked(reorderSections).mockResolvedValue({ ok: false, error: "generic" });
    renderReport();

    await moveWithKeyboard("Contexte", "ArrowDown", 1);

    expect(reorderSections).toHaveBeenCalledWith(REPORT_ID, [ANALYSIS.id, CONTEXT.id, APPENDIX.id]);
    await waitFor(() => expect(tocTitles()).toEqual(["Contexte", "Analyse", "Annexes"]));
    expect(documentTitles()).toEqual(["1. Contexte", "2. Analyse", "3. Annexes"]);
    expect(reorderStatus()).toHaveTextContent("Le nouvel ordre n'a pas pu être enregistré. Réessayez.");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("reloads the page data when another session changed the list", async () => {
    vi.mocked(reorderSections).mockResolvedValue({ ok: false, error: "stale" });
    renderReport();

    await moveWithKeyboard("Analyse", "ArrowDown", 1);

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(tocTitles()).toEqual(["Contexte", "Analyse", "Annexes"]);
    expect(reorderStatus()).toHaveTextContent(/Les sections ont changé dans une autre session/);
  });

  it("treats an action that throws as a failed save", async () => {
    vi.mocked(reorderSections).mockRejectedValue(new Error("network"));
    renderReport();

    await moveWithKeyboard("Analyse", "ArrowUp", 1);

    await waitFor(() =>
      expect(reorderStatus()).toHaveTextContent("Le nouvel ordre n'a pas pu être enregistré."),
    );
    expect(tocTitles()).toEqual(["Contexte", "Analyse", "Annexes"]);
  });

  it("takes a new list from the server over the local order", async () => {
    vi.mocked(reorderSections).mockResolvedValue({ ok: true });
    const view = renderReport();
    await moveWithKeyboard("Annexes", "ArrowUp", 1);
    expect(tocTitles()).toEqual(["Contexte", "Annexes", "Analyse"]);

    // Another session moved "Analyse" first in the meantime.
    view.rerender(
      <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
        <MasterReport
          reportId={REPORT_ID}
          workspaceId={WORKSPACE_ID}
          sections={[ANALYSIS, CONTEXT, APPENDIX]}
          assignees={[]}
          canManage
        />
      </NextIntlClientProvider>,
    );
    expect(tocTitles()).toEqual(["Analyse", "Contexte", "Annexes"]);
  });
});

describe("MasterReport for a reader", () => {
  it("shows every section and its text, without handles, with Modifier on editable ones only", () => {
    renderReport({ canManage: false });

    expect(screen.queryAllByRole("button", { name: /^Déplacer la section/ })).toHaveLength(0);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();

    const edits = screen.getAllByRole("link", { name: /^Modifier/ });
    expect(edits).toHaveLength(2);
    for (const link of edits) {
      expect(link).toHaveAccessibleName("Modifier la section Contexte");
      expect(link).toHaveAttribute("href", `/fr/espaces/${WORKSPACE_ID}/sections/${CONTEXT.id}`);
    }

    const first = within(toc()).getAllByRole("listitem")[1];
    if (!first) throw new Error("missing row");
    expect(first).toHaveTextContent("En cours");
    expect(first).toHaveTextContent("Eli Expert");
    expect(within(toc()).getAllByRole("listitem")[2]).toHaveTextContent("Non attribuée");
  });

  it("renders the Markdown under the section heading, links as text, and marks empty sections", () => {
    renderReport({ canManage: false });

    const context = screen.getByRole("article", { name: "1. Contexte" });
    expect(context).toHaveAttribute("id", `section-${CONTEXT.id}`);
    // #, ## and ### all sit right under the section title, as on the section page.
    expect(within(context).getByRole("heading", { level: 4, name: "Objectifs" })).toBeVisible();
    expect(within(context).getByRole("heading", { level: 4, name: "Points clés" })).toBeVisible();
    expect(within(context).getByText("12 %").tagName).toBe("STRONG");
    expect(within(context).queryByRole("link", { name: "Source" })).toBeNull();
    expect(context).toHaveTextContent("Source (https://example.com/rapport)");
    expect(context).toHaveTextContent("Fatou Dossou");
    expect(context).toHaveTextContent("Terminée");

    const appendix = screen.getByRole("article", { name: "3. Annexes" });
    expect(appendix).toHaveTextContent("Section non rédigée.");
    expect(appendix).toHaveTextContent("Non attribuée");
    expect(within(appendix).queryByRole("link", { name: /^Modifier/ })).toBeNull();
  });

  it("has no text block when the report has no section", () => {
    renderReport({ sections: [], canManage: false });
    expect(screen.getByText("Ce rapport n'a pas encore de sections.")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Texte du rapport" })).toBeNull();
  });
});
