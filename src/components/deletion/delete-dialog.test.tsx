import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DeletionState } from "@/lib/deletions/errors";
import { DeleteDialog, type DeleteDialogLabels } from "./delete-dialog";

const ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";

const labels: DeleteDialogLabels = {
  trigger: "Supprimer le rapport",
  title: "Supprimer le rapport ?",
  description:
    "« Audit du siège » sera supprimé pour tous les membres de l'espace. Cette action est définitive.",
  confirm: "Supprimer le rapport",
  pending: "Suppression…",
  cancel: "Annuler",
  typed: "Saisissez « Audit du siège » pour confirmer",
  mismatch: "Le texte ne correspond pas. Recopiez-le exactement, majuscules et accents compris.",
};

type Action = (state: DeletionState, formData: FormData) => Promise<DeletionState>;

function renderDialog(action: Action, expected?: string, blocked?: string) {
  render(
    <DeleteDialog action={action} id={ID} expected={expected} labels={labels} blocked={blocked}>
      <p>3 sections et leur texte</p>
    </DeleteDialog>,
  );
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Supprimer le rapport" }));
  const dialog = await screen.findByRole("dialog", { name: "Supprimer le rapport ?" });
  return { user, dialog };
}

describe("DeleteDialog", () => {
  it("names what goes, and deletes on confirmation when no text is asked", async () => {
    const action = vi.fn<Action>(async () => ({ status: "idle" }));
    renderDialog(action);
    const { user, dialog } = await openDialog();

    expect(dialog).toHaveAccessibleDescription(/Audit du siège/);
    expect(dialog).toHaveTextContent("3 sections et leur texte");
    expect(screen.queryByRole("textbox")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Supprimer le rapport" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const formData = action.mock.calls[0]![1];
    expect(formData.get("id")).toBe(ID);
  });

  it("refuses to send until the exact title is typed", async () => {
    const action = vi.fn<Action>(async () => ({ status: "idle" }));
    renderDialog(action, "Audit du siège");
    const { user } = await openDialog();

    const field = screen.getByLabelText("Saisissez « Audit du siège » pour confirmer");
    await user.type(field, "audit du siège");
    await user.click(screen.getByRole("button", { name: "Supprimer le rapport" }));

    expect(action).not.toHaveBeenCalled();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(labels.mismatch!);
    expect(field).toHaveFocus();

    await user.clear(field);
    await user.type(field, " Audit du siège ");
    expect(field).toHaveAttribute("aria-invalid", "false");
    await user.click(screen.getByRole("button", { name: "Supprimer le rapport" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const formData = action.mock.calls[0]![1];
    expect(formData.get("confirmation")).toBe(" Audit du siège ");
  });

  it("shows the refusal of the server", async () => {
    const action = vi.fn<Action>(async () => ({
      status: "error",
      error: "forbidden",
      message: "Vous n'avez pas les droits pour faire cette suppression.",
    }));
    renderDialog(action);
    const { user } = await openDialog();

    await user.click(screen.getByRole("button", { name: "Supprimer le rapport" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vous n'avez pas les droits pour faire cette suppression.",
    );
  });

  it("says why the deletion waits and offers no way to confirm", async () => {
    const action = vi.fn<Action>(async () => ({ status: "idle" }));
    const blocked =
      "Un paiement de l'organisation est en cours ou en vérification. Vous pourrez supprimer l'organisation une fois le paiement abouti.";
    renderDialog(action, "Audit du siège", blocked);
    const { user, dialog } = await openDialog();

    expect(dialog).toHaveTextContent("3 sections et leur texte");
    expect(screen.getByRole("note")).toHaveTextContent(blocked);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Supprimer le rapport" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(action).not.toHaveBeenCalled();
  });
});
