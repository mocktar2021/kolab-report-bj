import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/core";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../../messages/fr.json";
import { uploadDeliverable } from "@/lib/deliverables/upload";
import { DeliverableList, type DeliverableRow } from "./deliverable-list";
import { ImageInsertProvider } from "./image-insert";
import { EDITOR_MODE_STORAGE_KEY, SectionEditor } from "./section-editor";

// Images in the section's text (KRB-216): pasted or dropped files are
// uploaded as deliverables first, and "Insérer dans le texte" in the list
// puts a PNG or JPEG deliverable in the editor.

vi.mock("./content-actions", () => ({ saveSectionContent: vi.fn() }));
vi.mock("./actions", () => ({ deleteDeliverable: vi.fn(), retryParse: vi.fn() }));
vi.mock("@/lib/deliverables/upload", () => ({ uploadDeliverable: vi.fn() }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

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
const IMAGE_ID = "0b6f5e1c-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
const REFERENCE = `![capture](/api/deliverables/${IMAGE_ID}/file)`;

const uploadMock = () => vi.mocked(uploadDeliverable);

const ROW: DeliverableRow = {
  id: IMAGE_ID,
  name: "Façade_nord.jpg",
  mimeType: "image/jpeg",
  size: 2048,
  uploadedAt: "2026-10-13T09:00:00Z",
  uploaderName: "Edgar Expert",
  parseState: "skipped",
  parseError: null,
  notStarted: false,
  canDelete: false,
  canRetry: false,
};

function renderPage(content: string | null, rows: DeliverableRow[] = []) {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <ImageInsertProvider>
        <SectionEditor sectionId={SECTION_ID} content={content} version="v1" draftHint={false} />
        <DeliverableList files={rows} canEdit />
      </ImageInsertProvider>
    </NextIntlClientProvider>,
  );
  return user;
}

/** Enough of a DataTransfer for a paste or a drop. */
function clipboard(files: File[], text = "") {
  return { files, types: ["Files"], getData: (type: string) => (type === "text/plain" ? text : "") };
}

const png = (name = "capture.png") =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
const textarea = () => screen.getByLabelText("Texte de la section (Markdown)") as HTMLTextAreaElement;

describe("images pasted in the Markdown tab", () => {
  it("uploads a pasted PNG as a deliverable, then puts it after the cursor", async () => {
    window.localStorage.setItem(EDITOR_MODE_STORAGE_KEY, "markdown");
    let finish: (value: Awaited<ReturnType<typeof uploadDeliverable>>) => void = () => {};
    uploadMock().mockImplementation(async (_section, _file, { onProgress }) => {
      onProgress(0.4);
      return new Promise((resolve) => (finish = resolve));
    });
    const user = renderPage("Avant.\n\nAprès.");
    await user.click(screen.getByRole("button", { name: "Modifier le texte" }));
    textarea().setSelectionRange(6, 6);

    const file = png();
    fireEvent.paste(textarea(), { clipboardData: clipboard([file]) });
    await waitFor(() => expect(uploadMock()).toHaveBeenCalledWith(SECTION_ID, file, expect.anything()));
    expect(await screen.findByText("Envoi de capture.png : 40 %")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Envoi de capture.png" })).toHaveAttribute(
      "aria-valuenow",
      "40",
    );

    await act(async () => finish({ ok: true, deliverableId: IMAGE_ID }));
    await waitFor(() => expect(textarea()).toHaveValue(`Avant.\n\n${REFERENCE}\n\nAprès.`));
    expect(screen.getByText("Image insérée dans le texte. Enregistrez pour la garder.")).toBeVisible();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses other types with a message, and says why the server refused an image", async () => {
    window.localStorage.setItem(EDITOR_MODE_STORAGE_KEY, "markdown");
    uploadMock().mockResolvedValue({ ok: false, error: "reportFinal" });
    const user = renderPage("Texte.");
    await user.click(screen.getByRole("button", { name: "Modifier le texte" }));

    const notes = new File(["x"], "notes.txt", { type: "text/plain" });
    fireEvent.drop(textarea(), { dataTransfer: clipboard([notes]) });
    expect(
      await screen.findByText(
        "notes.txt n'a pas été ajoutée au texte : Seules les images PNG et JPEG vont dans le texte. Déposez les autres fichiers dans Déposer des livrables.",
      ),
    ).toHaveAttribute("role", "alert");
    expect(uploadMock()).not.toHaveBeenCalled();

    fireEvent.paste(textarea(), { clipboardData: clipboard([png("plan.png")]) });
    expect(
      await screen.findByText(
        "plan.png n'a pas été ajoutée au texte : Ce rapport est final. Un propriétaire doit le rouvrir pour le modifier.",
      ),
    ).toBeVisible();
    expect(textarea()).toHaveValue("Texte.");

    // Text copied from Word comes with a picture of it: it stays a text paste.
    uploadMock().mockClear();
    fireEvent.paste(textarea(), { clipboardData: clipboard([png()], "Tableau des mesures") });
    expect(uploadMock()).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole("button", { name: "Fermer" })[0]!);
    expect(screen.queryByText(/^notes\.txt/)).toBeNull();
  });
});

describe("images in the Texte tab", () => {
  it("uploads a pasted image and draws it where it was pasted", async () => {
    uploadMock().mockResolvedValue({ ok: true, deliverableId: IMAGE_ID });
    const user = renderPage("Avant.\n\nAprès.");
    await user.click(screen.getByRole("button", { name: "Modifier le texte" }));
    const field = await screen.findByRole("textbox", { name: "Texte de la section" });
    const editor = (field as HTMLElement & { editor?: Editor }).editor!;
    act(() => {
      editor.commands.setTextSelection(7);
    });

    fireEvent.paste(field, { clipboardData: clipboard([png()]) });
    await waitFor(() => expect(within(field).getByRole("img", { name: "capture" })).toBeInTheDocument());
    expect(within(field).getByRole("img", { name: "capture" })).toHaveAttribute(
      "src",
      `/api/deliverables/${IMAGE_ID}/file?image`,
    );
    await user.click(screen.getByRole("tab", { name: "Markdown" }));
    expect(textarea()).toHaveValue(`Avant.\n\n${REFERENCE}\n\nAprès.`);
  });
});

describe("Insérer dans le texte", () => {
  it("opens the editor with the image at the end of the text", async () => {
    window.localStorage.setItem(EDITOR_MODE_STORAGE_KEY, "markdown");
    const user = renderPage("Constats.", [ROW]);
    await user.click(screen.getByRole("button", { name: "Insérer Façade_nord.jpg dans le texte" }));
    expect(textarea()).toHaveValue(`Constats.\n\n![Façade nord](/api/deliverables/${IMAGE_ID}/file)`);
    // The cursor after the image, at the end of the text.
    await waitFor(() => expect(textarea()).toHaveFocus());
    expect(textarea().selectionStart).toBe(textarea().value.length);
    expect(screen.getByText("Image insérée dans le texte. Enregistrez pour la garder.")).toBeVisible();
  });

  it("puts the image at the cursor of an open editor", async () => {
    window.localStorage.setItem(EDITOR_MODE_STORAGE_KEY, "markdown");
    const user = renderPage("Un.\n\nDeux.", [ROW]);
    await user.click(screen.getByRole("button", { name: "Modifier le texte" }));
    textarea().setSelectionRange(3, 3);
    await user.click(screen.getByRole("button", { name: "Insérer Façade_nord.jpg dans le texte" }));
    expect(textarea()).toHaveValue(`Un.\n\n![Façade nord](/api/deliverables/${IMAGE_ID}/file)\n\nDeux.`);
  });

  it("is offered on PNG and JPEG files only, to people who can edit the text", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
        <ImageInsertProvider>
          <DeliverableList
            files={[ROW, { ...ROW, id: "x", name: "schema.svg", mimeType: "image/svg+xml" }]}
            canEdit
          />
          <DeliverableList
            files={[{ ...ROW, id: "y", name: "lecture.png", mimeType: "image/png" }]}
            canEdit={false}
          />
        </ImageInsertProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByRole("button", { name: /^Insérer .* dans le texte$/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Insérer Façade_nord.jpg dans le texte" })).toBeInTheDocument();
  });
});
