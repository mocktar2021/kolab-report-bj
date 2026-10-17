import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/core";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../../messages/fr.json";
import { hasUnsavedWork } from "@/lib/unsaved-work";
import { saveSectionContent } from "./content-actions";
import { EDITOR_MODE_STORAGE_KEY, SectionEditor } from "./section-editor";

vi.mock("./content-actions", () => ({ saveSectionContent: vi.fn() }));

beforeAll(() => {
  // jsdom draws nothing: ProseMirror measures the selection to scroll to it.
  const rects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects ??= rects;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  Element.prototype.getClientRects ??= rects;
  document.elementFromPoint ??= () => null;
});

afterEach(() => {
  window.localStorage.clear();
});

const SECTION_ID = "6f1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
// content_updated_at strings as Supabase returns them, microseconds included.
const V1 = "2026-10-13T09:00:00.123456+00:00";
const V2 = "2026-10-13T09:05:00.654321+00:00";
const V3 = "2026-10-13T09:10:00.000001+00:00";
const V4 = "2026-10-13T09:15:00.999999+00:00";

const CONFLICT_TITLE = "Quelqu'un a modifié cette section pendant que vous écriviez.";

type Props = { content: string | null; version: string; draftHint?: boolean };

function editor({ content, version, draftHint = false }: Props) {
  return (
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <SectionEditor sectionId={SECTION_ID} content={content} version={version} draftHint={draftHint} />
    </NextIntlClientProvider>
  );
}

function renderEditor(props: Props = { content: "Texte initial.", version: V1 }) {
  const user = userEvent.setup();
  const view = render(editor(props));
  return { user, rerender: (next: Props) => view.rerender(editor(next)) };
}

const saveMock = () => vi.mocked(saveSectionContent);
const textarea = () => screen.getByLabelText("Texte de la section (Markdown)") as HTMLTextAreaElement;
const openButton = () => screen.getByRole("button", { name: "Modifier le texte" });
const previewButton = () => screen.getByRole("button", { name: "Aperçu du contenu de la section" });
const saveButton = () => screen.getByRole("button", { name: "Enregistrer" });

async function openAndWrite(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.click(openButton());
  await user.clear(textarea());
  await user.type(textarea(), value);
}

describe("SectionEditor in Markdown mode", () => {
  beforeEach(() => {
    window.localStorage.setItem(EDITOR_MODE_STORAGE_KEY, "markdown");
  });

  it("opens on the current text with the focus in it, and cancel goes back to the text", async () => {
    const { user } = renderEditor();
    expect(screen.getByRole("heading", { level: 2, name: "Contenu de la section" })).toBeVisible();
    // The text shows with Aperçu (KRB-201).
    expect(screen.queryByText("Texte initial.")).toBeNull();
    await user.click(previewButton());
    expect(screen.getByText("Texte initial.")).toBeVisible();

    await user.click(openButton());
    expect(screen.queryByRole("button", { name: "Masquer l'aperçu du contenu de la section" })).toBeNull();
    expect(textarea()).toHaveValue("Texte initial.");
    expect(textarea()).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Modifier le texte" })).toBeNull();

    await user.type(textarea(), " Brouillon.");
    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByLabelText("Texte de la section (Markdown)")).toBeNull();
    expect(screen.getByText("Texte initial.")).toBeVisible();
    expect(openButton()).toHaveFocus();
    expect(saveMock()).not.toHaveBeenCalled();
  });

  it("saves the text and sends the returned version with the next save", async () => {
    saveMock()
      .mockResolvedValueOnce({ ok: true, version: V2 })
      .mockResolvedValueOnce({ ok: true, version: V3 })
      .mockResolvedValueOnce({ ok: true, version: V4 });
    const { user } = renderEditor();

    await openAndWrite(user, "Nouveau texte.");
    await user.click(saveButton());
    expect(saveMock()).toHaveBeenLastCalledWith({
      sectionId: SECTION_ID,
      content: "Nouveau texte.",
      expectedVersion: V1,
    });
    expect(await screen.findByText("Texte enregistré.")).toBeVisible();
    expect(screen.queryByLabelText("Texte de la section (Markdown)")).toBeNull();
    expect(screen.getByText("Nouveau texte.")).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Contenu de la section" })).toHaveFocus();

    // Ctrl+S saves and keeps the editor open.
    await user.click(openButton());
    await user.type(textarea(), " Suite.");
    await user.keyboard("{Control>}s{/Control}");
    await waitFor(() =>
      expect(saveMock()).toHaveBeenLastCalledWith({
        sectionId: SECTION_ID,
        content: "Nouveau texte. Suite.",
        expectedVersion: V2,
      }),
    );
    expect(await screen.findByText("Texte enregistré.")).toBeInTheDocument();
    expect(textarea()).toHaveValue("Nouveau texte. Suite.");

    await user.type(textarea(), " Fin.");
    await user.keyboard("{Meta>}s{/Meta}");
    await waitFor(() => expect(saveMock()).toHaveBeenCalledTimes(3));
    expect(saveMock()).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: V3 }));
  });

  it("clears the section when the text is saved empty", async () => {
    saveMock().mockResolvedValueOnce({ ok: true, version: V2 });
    const { user } = renderEditor({ content: "Texte initial.", version: V1, draftHint: true });
    await user.click(openButton());
    await user.clear(textarea());
    await user.click(saveButton());
    expect(await screen.findByText("Texte effacé. La section n'a plus de contenu.")).toBeVisible();
    expect(saveMock()).toHaveBeenCalledWith({ sectionId: SECTION_ID, content: "", expectedVersion: V1 });
    expect(screen.getByText("Aucun contenu pour l'instant.")).toBeVisible();
  });

  it("shows a conflict with both versions and keeps the user's text", async () => {
    saveMock().mockResolvedValueOnce({
      ok: false,
      error: "conflict",
      current: { content: "Texte initial.\nAjout de Marie.", version: V2 },
    });
    const { user } = renderEditor();
    await user.click(openButton());
    await user.type(textarea(), "\nAjout de l'expert.");
    await user.click(saveButton());

    const title = await screen.findByRole("heading", { level: 3, name: CONFLICT_TITLE });
    await waitFor(() => expect(title).toHaveFocus());
    expect(screen.getByText(/Comparez les deux versions avant d'enregistrer/)).toBeVisible();

    const compare = screen.getByRole("group", { name: "Votre version et la version enregistrée" });
    const mine = within(compare).getByRole("region", { name: "Votre version" });
    const saved = within(compare).getByRole("region", { name: "Version enregistrée" });
    expect(mine).toHaveTextContent("Ajout de l'expert.");
    expect(mine).not.toHaveTextContent("Ajout de Marie.");
    expect(saved).toHaveTextContent("Ajout de Marie.");
    // The lines found in one version only are marked, not by color alone.
    expect(within(saved).getByText(/Ligne différente/).parentElement).toHaveTextContent("Ajout de Marie.");

    expect(textarea()).toHaveValue("Texte initial.\nAjout de l'expert.");
    expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();
    expect(screen.getByRole("button", { name: "Garder ma version" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reprendre la version enregistrée" })).toBeVisible();

    // Ctrl+S doesn't overwrite: it brings the focus back to the choice.
    textarea().focus();
    await user.keyboard("{Control>}s{/Control}");
    expect(title).toHaveFocus();
    expect(saveMock()).toHaveBeenCalledTimes(1);
  });

  it("keeps the user's version with the saved version, and shows a newer one if it changed again", async () => {
    saveMock()
      .mockResolvedValueOnce({
        ok: false,
        error: "conflict",
        current: { content: "Texte de Marie.", version: V2 },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: "conflict",
        current: { content: "Texte de Paul.", version: V3 },
      })
      .mockResolvedValueOnce({ ok: true, version: V4 });
    const { user } = renderEditor();
    await openAndWrite(user, "Texte de l'expert.");
    await user.click(saveButton());
    await screen.findByRole("heading", { name: CONFLICT_TITLE });

    await user.click(screen.getByRole("button", { name: "Garder ma version" }));
    expect(saveMock()).toHaveBeenLastCalledWith({
      sectionId: SECTION_ID,
      content: "Texte de l'expert.",
      expectedVersion: V2,
    });
    expect(
      await screen.findByText(
        "La version enregistrée a encore changé. La comparaison montre la plus récente.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("region", { name: "Version enregistrée" })).toHaveTextContent("Texte de Paul.");
    expect(screen.getByRole("heading", { name: CONFLICT_TITLE })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Garder ma version" }));
    expect(saveMock()).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: V3 }));
    expect(await screen.findByText("Votre version est enregistrée.")).toBeVisible();
    expect(screen.queryByRole("heading", { name: CONFLICT_TITLE })).toBeNull();
    expect(screen.getByText("Texte de l'expert.")).toBeVisible();
  });

  it("takes the saved version into the editor and saves on top of it", async () => {
    saveMock()
      .mockResolvedValueOnce({
        ok: false,
        error: "conflict",
        current: { content: "Texte de Marie.", version: V2 },
      })
      .mockResolvedValueOnce({ ok: true, version: V3 });
    const { user } = renderEditor();
    await openAndWrite(user, "Texte de l'expert.");
    await user.click(saveButton());
    await screen.findByRole("heading", { name: CONFLICT_TITLE });

    await user.click(screen.getByRole("button", { name: "Reprendre la version enregistrée" }));
    expect(textarea()).toHaveValue("Texte de Marie.");
    expect(textarea()).toHaveFocus();
    expect(screen.getByText("La version enregistrée est reprise dans l'éditeur.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: CONFLICT_TITLE })).toBeNull();

    await user.type(textarea(), " Complété.");
    await user.click(saveButton());
    expect(saveMock()).toHaveBeenLastCalledWith({
      sectionId: SECTION_ID,
      content: "Texte de Marie. Complété.",
      expectedVersion: V2,
    });
  });

  it("takes new page data while closed or unchanged, and keeps the user's changes otherwise", async () => {
    saveMock().mockResolvedValue({ ok: true, version: V4 });
    const { user, rerender } = renderEditor();

    // Closed: an accepted draft replaces the text.
    rerender({ content: "Brouillon accepté.", version: V2 });
    await user.click(previewButton());
    expect(screen.getByText("Brouillon accepté.")).toBeVisible();

    // Open without changes: the editor follows.
    await user.click(openButton());
    expect(textarea()).toHaveValue("Brouillon accepté.");
    rerender({ content: "Brouillon accepté, puis relu.", version: V3 });
    expect(textarea()).toHaveValue("Brouillon accepté, puis relu.");

    // With changes: the editor keeps them and its version.
    await user.type(textarea(), " Mon ajout.");
    rerender({ content: "Une autre version.", version: V4 });
    expect(textarea()).toHaveValue("Brouillon accepté, puis relu. Mon ajout.");
    expect(screen.getByText(/Le texte enregistré a changé depuis l'ouverture de l'éditeur/)).toBeVisible();
    await user.click(saveButton());
    expect(saveMock()).toHaveBeenLastCalledWith({
      sectionId: SECTION_ID,
      content: "Brouillon accepté, puis relu. Mon ajout.",
      expectedVersion: V3,
    });
  });

  it("shows the counter near the limit and refuses a text that is too long", async () => {
    const { user } = renderEditor();
    await user.click(openButton());
    const counter = /\/ 100\s000 caractères/;

    fireEvent.change(textarea(), { target: { value: "a".repeat(89_999) } });
    expect(screen.queryByText(counter)).toBeNull();

    fireEvent.change(textarea(), { target: { value: "a".repeat(95_000) } });
    expect(screen.getByText(/^95\s000 \/ 100\s000 caractères$/)).toBeVisible();
    expect(textarea()).toHaveAttribute("aria-invalid", "false");

    fireEvent.change(textarea(), { target: { value: "a".repeat(100_001) } });
    expect(screen.getByText(/^100\s001 \/ 100\s000 caractères$/)).toBeVisible();
    expect(
      screen.getByText(/^Le texte dépasse 100\s000 caractères\. Raccourcissez-le pour l'enregistrer\.$/),
    ).toBeVisible();
    expect(textarea()).toHaveAttribute("aria-invalid", "true");
    expect(saveButton()).toHaveAttribute("aria-disabled", "true");
    await user.click(saveButton());
    textarea().focus();
    await user.keyboard("{Control>}s{/Control}");
    expect(saveMock()).not.toHaveBeenCalled();
  });

  it("explains the other errors in French and keeps the text", async () => {
    saveMock()
      .mockResolvedValueOnce({ ok: false, error: "forbidden" })
      .mockResolvedValueOnce({ ok: false, error: "tooLong" })
      .mockResolvedValueOnce({ ok: false, error: "invalidInput" })
      .mockRejectedValueOnce(new Error("network"));
    const { user } = renderEditor();
    await openAndWrite(user, "Texte à garder.");

    const expected = [
      "Vous ne pouvez plus modifier cette section. Copiez votre texte si vous voulez le garder.",
      "Le texte dépasse 100 000 caractères. Raccourcissez-le puis réessayez.",
      "Le texte n'a pas pu être enregistré. Copiez-le, rechargez la page puis réessayez.",
      "Le texte n'a pas pu être enregistré. Réessayez.",
    ];
    for (const message of expected) {
      await user.click(saveButton());
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(textarea()).toHaveValue("Texte à garder.");
    }
  });

  it("warns before leaving the page while the text has unsaved changes", async () => {
    const { user } = renderEditor();
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    await user.click(openButton());
    expect(leave()).toBe(false);
    await user.type(textarea(), " Ajout.");
    expect(leave()).toBe(true);
    // The update banner does not reload the page meanwhile (KRB-156).
    expect(hasUnsavedWork()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(leave()).toBe(false);
    expect(hasUnsavedWork()).toBe(false);
  });

  it("previews the Markdown with links as text, and Ctrl+S still saves from there", async () => {
    saveMock().mockResolvedValueOnce({ ok: true, version: V2 });
    const { user } = renderEditor();
    await user.click(openButton());
    fireEvent.change(textarea(), {
      target: { value: "## Constats\n\nVoir [le site](https://example.com)." },
    });

    const toggle = screen.getByRole("button", { name: "Aperçu" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(textarea()).not.toBeVisible();
    const preview = screen.getByRole("region", { name: "Aperçu" });
    expect(within(preview).getByRole("heading", { level: 3, name: "Constats" })).toBeVisible();
    expect(within(preview).queryAllByRole("link")).toHaveLength(0);
    expect(preview).toHaveTextContent("Voir le site (https://example.com).");

    await user.keyboard("{Control>}s{/Control}");
    await waitFor(() =>
      expect(saveMock()).toHaveBeenCalledWith(
        expect.objectContaining({ content: "## Constats\n\nVoir [le site](https://example.com)." }),
      ),
    );
  });
});

const VISUAL_LABEL = "Texte de la section";

/** The Texte editor, once its code has loaded. */
const visualEditor = () => screen.findByRole("textbox", { name: VISUAL_LABEL });

/** The Tiptap editor behind the Texte field, to place the selection: jsdom has no layout to click into. */
function tiptap(element: HTMLElement): Editor {
  const editor = (element as HTMLElement & { editor?: Editor }).editor;
  if (!editor) throw new Error("No editor on the element");
  return editor;
}

const MARKDOWN = "## Constats\n\nLe **bâtiment** consomme 412 MWh par an.\n\n* chaufferie\n* éclairage";

describe("SectionEditor in Texte mode", () => {
  it("opens in Texte mode with a toolbar and no Markdown symbols, with the focus in the text", async () => {
    const { user } = renderEditor({ content: MARKDOWN, version: V1 });
    await user.click(openButton());

    const field = await visualEditor();
    await waitFor(() => expect(field).toHaveFocus());
    expect(screen.getByRole("tab", { name: "Texte" })).toHaveAttribute("aria-selected", "true");
    expect(field).toHaveTextContent("ConstatsLe bâtiment consomme 412 MWh par an.chaufferieéclairage");
    expect(field.textContent).not.toMatch(/[#*]/);
    expect(within(field).getByRole("heading", { name: "Constats" })).toBeInTheDocument();
    expect(within(field).getByText("bâtiment").tagName).toBe("STRONG");
    expect(within(field).getAllByRole("listitem")).toHaveLength(2);

    const toolbar = screen.getByRole("toolbar", { name: "Mise en forme" });
    for (const name of [
      "Titre 1",
      "Titre 2",
      "Titre 3",
      "Gras",
      "Italique",
      "Barré",
      "Liste à puces",
      "Liste numérotée",
      "Citation",
      "Lien",
      "Insérer un tableau",
    ]) {
      expect(within(toolbar).getByRole("button", { name })).toBeInTheDocument();
    }
    // Nothing Markdown can't hold.
    expect(within(toolbar).queryByRole("button", { name: /Souligné|Couleur|Police/ })).toBeNull();
    expect(screen.queryByLabelText("Texte de la section (Markdown)")).toBeNull();
  });

  it("shows the same text in the Markdown tab, unchanged when nothing was edited", async () => {
    const { user } = renderEditor({ content: MARKDOWN, version: V1 });
    await user.click(openButton());
    await visualEditor();

    await user.click(screen.getByRole("tab", { name: "Markdown" }));
    expect(textarea()).toHaveValue(MARKDOWN);
    expect(window.localStorage.getItem(EDITOR_MODE_STORAGE_KEY)).toBe("markdown");

    // A change in Markdown shows in the Texte tab.
    fireEvent.change(textarea(), { target: { value: `${MARKDOWN}\n\n> Citation ajoutée.` } });
    await user.click(screen.getByRole("tab", { name: "Texte" }));
    const field = await visualEditor();
    expect(within(field).getByText("Citation ajoutée.").closest("blockquote")).not.toBeNull();
    expect(window.localStorage.getItem(EDITOR_MODE_STORAGE_KEY)).toBe("text");
    expect(hasUnsavedWork()).toBe(true);
  });

  it("formats with the toolbar and saves the Markdown, keeping the untouched blocks as they were", async () => {
    saveMock().mockResolvedValueOnce({ ok: true, version: V2 });
    const { user } = renderEditor({ content: MARKDOWN, version: V1 });
    await user.click(openButton());
    const field = await visualEditor();
    const editor = tiptap(field);

    // Select "consomme" in the paragraph and make it italic.
    let from = 0;
    editor.state.doc.descendants((node, position) => {
      if (node.isText && node.text?.includes("consomme")) from = position + node.text.indexOf("consomme");
    });
    act(() => {
      editor.commands.setTextSelection({ from, to: from + "consomme".length });
    });
    await user.click(screen.getByRole("button", { name: "Italique" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Italique" })).toHaveAttribute("aria-pressed", "true"),
    );

    await user.click(screen.getByRole("tab", { name: "Markdown" }));
    const expected = MARKDOWN.replace("consomme", "*consomme*");
    expect(textarea()).toHaveValue(expected);
    await user.click(saveButton());
    expect(saveMock()).toHaveBeenCalledWith({
      sectionId: SECTION_ID,
      content: expected,
      expectedVersion: V1,
    });
  });

  it("inserts a table and a link, and Ctrl+S saves from the text", async () => {
    saveMock().mockResolvedValue({ ok: true, version: V2 });
    const { user } = renderEditor({ content: "Intro.", version: V1 });
    await user.click(openButton());
    const field = await visualEditor();
    const editor = tiptap(field);

    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    });
    await user.click(screen.getByRole("button", { name: "Insérer un tableau" }));
    expect(within(field).getByRole("table")).toBeInTheDocument();
    const toolbar = screen.getByRole("toolbar", { name: "Mise en forme" });
    expect(within(toolbar).getByRole("button", { name: "Ajouter une ligne" })).toBeInTheDocument();
    act(() => {
      editor.commands.insertContent("Poste");
    });

    // A link on the selected word "Intro".
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    await user.click(screen.getByRole("button", { name: "Lien" }));
    const address = screen.getByRole("textbox", { name: "Adresse du lien" });
    await waitFor(() => expect(address).toHaveFocus());
    await user.type(address, "javascript:alert(1){Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Saisissez une adresse web");
    await user.clear(address);
    await user.type(address, "www.ademe.fr{Enter}");
    expect(screen.queryByRole("textbox", { name: "Adresse du lien" })).toBeNull();

    field.focus();
    await user.keyboard("{Control>}s{/Control}");
    await waitFor(() =>
      expect(saveMock()).toHaveBeenLastCalledWith({
        sectionId: SECTION_ID,
        content: "[Intro](https://www.ademe.fr).\n\n| Poste | | |\n| - | - | - |\n| | | |\n| | | |",
        expectedVersion: V1,
      }),
    );
    // Saved with Ctrl+S: the editor stays open, on the same field.
    expect(await screen.findByText("Texte enregistré.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: VISUAL_LABEL })).toBe(field);
  });

  it("moves between table cells with Tab, and leaves the table from the last cell without adding a row", async () => {
    const table = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { user } = renderEditor({ content: table, version: V1 });
    await user.click(openButton());
    const field = await visualEditor();
    await waitFor(() => expect(field).toHaveFocus());
    const editor = tiptap(field);
    const cell = () => editor.state.selection.$from.parent.textContent;
    const into = (text: string) => {
      let at = 0;
      editor.state.doc.descendants((node, position) => {
        if (node.isText && node.text === text) at = position;
      });
      act(() => {
        editor.commands.setTextSelection(at);
      });
    };

    into("a");
    await user.keyboard("{Tab}");
    expect(cell()).toBe("b");
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(cell()).toBe("a");
    expect(field).toHaveFocus();

    into("2");
    await user.keyboard("{Tab}");
    expect(field).not.toHaveFocus();
    await user.click(screen.getByRole("tab", { name: "Markdown" }));
    expect(textarea()).toHaveValue(table);
  });

  it("moves between toolbar buttons with the arrow keys and goes back to the text with Escape", async () => {
    const { user } = renderEditor();
    await user.click(openButton());
    const field = await visualEditor();
    await waitFor(() => expect(field).toHaveFocus());

    // Alt+F10 goes to the toolbar.
    await user.keyboard("{Alt>}{F10}{/Alt}");
    const first = screen.getByRole("button", { name: "Titre 1" });
    expect(first).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Titre 2" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("button", { name: "Insérer un tableau" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(first).toHaveFocus();
    await user.keyboard("{Escape}");
    // Tiptap focuses on the next animation frame.
    await waitFor(() => expect(field).toHaveFocus());
    // One stop in the tab order.
    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.closest('[role="toolbar"]') && button.tabIndex === 0),
    ).toHaveLength(1);
  });

  it("remembers the last mode on the device", async () => {
    const { user } = renderEditor();
    await user.click(openButton());
    await visualEditor();
    await user.click(screen.getByRole("tab", { name: "Markdown" }));
    await user.click(screen.getByRole("button", { name: "Annuler" }));

    await user.click(openButton());
    expect(screen.getByRole("tab", { name: "Markdown" })).toHaveAttribute("aria-selected", "true");
    expect(textarea()).toHaveFocus();
  });

  it("still opens when the browser storage throws", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const { user } = renderEditor();
    await user.click(openButton());
    expect(screen.getByRole("tab", { name: "Texte" })).toHaveAttribute("aria-selected", "true");
    await visualEditor();
    await user.click(screen.getByRole("tab", { name: "Markdown" }));
    expect(textarea()).toHaveValue("Texte initial.");
    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();
  });

  it("loads an accepted draft into the open editor, and takes the saved version on a conflict", async () => {
    saveMock().mockResolvedValueOnce({
      ok: false,
      error: "conflict",
      current: { content: "### Version de Marie\n\nTexte relu.", version: V3 },
    });
    const { user, rerender } = renderEditor();
    await user.click(openButton());
    await visualEditor();

    // An accepted draft: new page data while the editor holds no change.
    rerender({ content: "### Points clés\n\n- Premier point", version: V2 });
    let field = await visualEditor();
    await waitFor(() =>
      expect(within(field).getByRole("heading", { name: "Points clés" })).toBeInTheDocument(),
    );
    expect(within(field).getByRole("listitem")).toHaveTextContent("Premier point");

    act(() => {
      tiptap(field).commands.insertContentAt(tiptap(field).state.doc.content.size, {
        type: "paragraph",
        content: [{ type: "text", text: "Ajout de l'expert." }],
      });
    });
    await user.click(saveButton());
    expect(saveMock()).toHaveBeenLastCalledWith({
      sectionId: SECTION_ID,
      content: "### Points clés\n\n- Premier point\n\nAjout de l'expert.",
      expectedVersion: V2,
    });
    await screen.findByRole("heading", { name: CONFLICT_TITLE });

    await user.click(screen.getByRole("button", { name: "Reprendre la version enregistrée" }));
    field = await visualEditor();
    await waitFor(() =>
      expect(within(field).getByRole("heading", { name: "Version de Marie" })).toBeInTheDocument(),
    );
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).not.toHaveTextContent("Ajout de l'expert.");
  });

  it("sends a text it can't show to the Markdown tab", async () => {
    const deep = `${">".repeat(300)} citation`;
    const { user } = renderEditor({ content: deep, version: V1 });
    await user.click(openButton());
    await user.click(await screen.findByRole("button", { name: "Ouvrir l'onglet Markdown" }));
    expect(screen.getByRole("tab", { name: "Markdown" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Markdown" })).toHaveFocus();
    expect(textarea()).toHaveValue(deep);
  });

  it("counts the Markdown length and refuses a text that is too long", async () => {
    const { user } = renderEditor({ content: "a".repeat(100_000), version: V1 });
    await user.click(openButton());
    const field = await visualEditor();
    act(() => {
      tiptap(field).commands.insertContentAt(1, "bb");
    });
    await waitFor(() => expect(screen.getByText(/^100\s002 \/ 100\s000 caractères$/)).toBeVisible());
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(saveButton()).toHaveAttribute("aria-disabled", "true");
  });
});
