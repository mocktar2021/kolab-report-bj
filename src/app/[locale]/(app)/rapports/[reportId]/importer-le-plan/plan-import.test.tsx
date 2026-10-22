import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../messages/fr.json";
import type { PlanReadBody } from "@/lib/plan/errors";
import { importPlan } from "./actions";
import { PlanImport } from "./plan-import";

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/i18n/navigation", () => ({ useRouter: () => router }));
vi.mock("./actions", () => ({ importPlan: vi.fn() }));

const REPORT_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";

const PLAN: PlanReadBody = {
  source: "numbers",
  truncated: false,
  items: [
    { title: "Contexte", level: 1, instructions: "Rappeler le projet." },
    { title: "Objectifs", level: 1, instructions: "" },
    { title: "Objectif général", level: 2, instructions: "" },
    { title: "Méthodologie", level: 1, instructions: "Décrire la collecte." },
  ],
};

function renderImport(pdfEnabled = true) {
  return render(
    <NextIntlClientProvider locale="fr" messages={{ PlanImport: messages.PlanImport }}>
      <PlanImport reportId={REPORT_ID} pdfEnabled={pdfEnabled} />
    </NextIntlClientProvider>,
  );
}

function answer(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

async function openPreview(plan: PlanReadBody = PLAN) {
  vi.mocked(fetch).mockReturnValueOnce(answer(200, plan));
  renderImport();
  fireEvent.change(screen.getByLabelText("Texte du plan"), { target: { value: "1. Contexte" } });
  fireEvent.click(screen.getByRole("button", { name: "Lire le texte" }));
  return screen.findByRole("heading", { name: "Vérifiez le plan" });
}

function titles() {
  return within(screen.getByRole("list", { name: "Éléments du plan" }))
    .getAllByRole("textbox", { name: /^Titre de l'élément/ })
    .map((input) => (input as HTMLInputElement).value);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PlanImport, reading", () => {
  it("sends pasted text as JSON and shows the plan it gets back", async () => {
    const heading = await openPreview();
    expect(fetch).toHaveBeenCalledWith(
      `/api/reports/${REPORT_ID}/plan`,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "1. Contexte" }),
      }),
    );
    expect(heading).toHaveFocus();
    expect(screen.getByText("4 éléments : 3 sections et 1 sous-section.")).toBeInTheDocument();
    expect(screen.getByText("Plan lu à partir de la numérotation des lignes.")).toBeInTheDocument();
    expect(titles()).toEqual(["Contexte", "Objectifs", "Objectif général", "Méthodologie"]);
    expect(screen.getByRole("textbox", { name: "Titre de l'élément 2.1" })).toBeInTheDocument();
  });

  it("sends a file as its bytes, with its name in a header", async () => {
    vi.mocked(fetch).mockReturnValueOnce(answer(200, PLAN));
    renderImport();
    const file = new File(["%PDF-1.4"], "Termes de référence.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Fichier du plan"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Lire le fichier" }));
    expect(screen.getByText("L'IA lit le PDF, cela peut prendre une minute…")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Vérifiez le plan" });
    expect(fetch).toHaveBeenCalledWith(
      `/api/reports/${REPORT_ID}/plan`,
      expect.objectContaining({
        headers: {
          "Content-Type": "application/octet-stream",
          "x-file-name": "Termes%20de%20r%C3%A9f%C3%A9rence.pdf",
        },
        body: file,
      }),
    );
  });

  it("opens the file field from a French button and shows the chosen name", () => {
    renderImport();
    const input = screen.getByLabelText("Fichier du plan");
    expect(screen.getByText("Aucun fichier choisi")).toBeInTheDocument();
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByText("Choisir un fichier"));
    expect(click).toHaveBeenCalledOnce();
    fireEvent.change(input, { target: { files: [new File(["# Plan"], "plan.md")] } });
    expect(screen.getByText("plan.md")).toBeInTheDocument();
    expect(screen.queryByText("Aucun fichier choisi")).not.toBeInTheDocument();
  });

  it("checks the file before sending it", () => {
    renderImport(false);
    expect(screen.getByLabelText("Fichier du plan")).toHaveAttribute("accept", ".docx,.txt,.md");
    expect(
      screen.getByText("La lecture des PDF par l'IA n'est pas disponible pour le moment."),
    ).toBeInTheDocument();
    const input = screen.getByLabelText("Fichier du plan");
    fireEvent.change(input, { target: { files: [new File(["x"], "plan.odt")] } });
    fireEvent.click(screen.getByRole("button", { name: "Lire le fichier" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Ce type de fichier n'est pas accepté.");
    expect(input).toHaveFocus();
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array(4 * 1024 * 1024 + 1)], "plan.docx")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lire le fichier" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Ce fichier est trop volumineux : 4 Mo au plus.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says when nothing was found, and when the month's drafts are used up", async () => {
    vi.mocked(fetch)
      .mockReturnValueOnce(answer(422, { error: "nothingFound" }))
      .mockReturnValueOnce(
        answer(402, { error: "quotaExceeded", values: { max: 60, date: "1er novembre" } }),
      );
    renderImport();
    const textarea = screen.getByLabelText("Texte du plan");
    fireEvent.change(textarea, { target: { value: "Bonjour" } });
    fireEvent.click(screen.getByRole("button", { name: "Lire le texte" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Aucun titre trouvé\./);
    expect(textarea).toHaveFocus();

    const file = new File(["%PDF-1.4"], "tdr.pdf");
    fireEvent.change(screen.getByLabelText("Fichier du plan"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Lire le fichier" }));
    expect(await screen.findByText(/Les 60 brouillons IA du mois sont utilisés/)).toHaveTextContent(
      "attendez le 1er novembre",
    );
  });
});

describe("PlanImport, preview", () => {
  it("renames an item and switches it between section and subsection", async () => {
    await openPreview();
    fireEvent.change(screen.getByRole("textbox", { name: "Titre de l'élément 2." }), {
      target: { value: "Objectifs de l'étude" },
    });
    const level = screen.getByRole("combobox", { name: "Type de l'élément 2." });
    fireEvent.change(level, { target: { value: "2" } });
    expect(screen.getByText("« Objectifs de l'étude » devient une sous-section.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Titre de l'élément 1.1" })).toHaveValue(
      "Objectifs de l'étude",
    );
    expect(screen.getByRole("combobox", { name: "Type de l'élément 1." })).toBeDisabled();
  });

  it("opens the instructions of an item", async () => {
    await openPreview();
    const toggle = within(screen.getAllByRole("listitem")[0]!).getByRole("button", { name: /Consignes/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("(19 caractères)");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: "Consignes de l'élément 1. pour l'IA" })).toHaveValue(
      "Rappeler le projet.",
    );
  });

  it("moves an item down and keeps the focus on its button", async () => {
    await openPreview();
    const down = screen.getByRole("button", { name: "Descendre « Contexte »" });
    fireEvent.click(down);
    expect(titles()).toEqual(["Objectifs", "Contexte", "Objectif général", "Méthodologie"]);
    expect(screen.getByRole("button", { name: "Descendre « Contexte »" })).toHaveFocus();
    expect(screen.getByText("« Contexte » passe en position 2 sur 4.")).toBeInTheDocument();
    const up = screen.getByRole("button", { name: "Monter « Objectifs »" });
    expect(up).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(up);
    expect(titles()[0]).toBe("Objectifs");
  });

  it("makes the first item a section when a subsection reaches the top", async () => {
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "Retirer « Contexte »" }));
    fireEvent.click(screen.getByRole("button", { name: "Retirer « Objectifs »" }));
    expect(titles()).toEqual(["Objectif général", "Méthodologie"]);
    expect(screen.getByRole("combobox", { name: "Type de l'élément 1." })).toHaveValue("1");
    expect(screen.getByRole("textbox", { name: "Titre de l'élément 1." })).toHaveFocus();
    expect(screen.getByText("« Objectifs » est retiré du plan.")).toBeInTheDocument();
  });

  it("merges an item into the one before it", async () => {
    await openPreview();
    fireEvent.click(
      screen.getByRole("button", { name: "Fusionner « Méthodologie » avec l'élément précédent" }),
    );
    expect(titles()).toEqual(["Contexte", "Objectifs", "Objectif général"]);
    const instructions = screen.getByRole("textbox", { name: "Consignes de l'élément 2.1 pour l'IA" });
    expect(instructions).toHaveValue("Méthodologie\n\nDécrire la collecte.");
    expect(instructions).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Fusionner « Contexte » avec l'élément précédent" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("asks for a title before creating, then creates the sections and opens the report", async () => {
    vi.mocked(importPlan).mockResolvedValue({ ok: true, count: 4 });
    await openPreview();
    const second = screen.getByRole("textbox", { name: "Titre de l'élément 2." });
    fireEvent.change(second, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Créer les 4 sections" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Corrigez les éléments signalés");
    expect(second).toHaveFocus();
    expect(second).toHaveAccessibleDescription("Donnez un titre à cet élément.");
    expect(importPlan).not.toHaveBeenCalled();

    fireEvent.change(second, { target: { value: " Objectifs " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Créer les 4 sections" }));
    });
    expect(importPlan).toHaveBeenCalledWith(REPORT_ID, [
      { title: "Contexte", level: 1, instructions: "Rappeler le projet." },
      { title: "Objectifs", level: 1, instructions: "" },
      { title: "Objectif général", level: 2, instructions: "" },
      { title: "Méthodologie", level: 1, instructions: "Décrire la collecte." },
    ]);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/rapports/${REPORT_ID}`));
  });

  it("shows why the sections were not created", async () => {
    vi.mocked(importPlan).mockResolvedValue({ ok: false, error: "readOnly" });
    await openPreview();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Créer les 4 sections" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Cet espace de travail est en lecture seule : aucune section ne peut être créée.",
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it("goes back to the choice of a file", async () => {
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "Choisir un autre fichier" }));
    expect(screen.getByRole("button", { name: "Lire le texte" })).toBeInTheDocument();
  });
});
