import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../../../messages/fr.json";
import { writeTemplateWithAi } from "../../assist-actions";
import { savePromptVersion } from "../../actions";
import { DescribeTemplate } from "./describe-template";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode; className?: string }) => (
    <a href={`/fr${href}`} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => router,
}));
vi.mock("../../assist-actions", () => ({ writeTemplateWithAi: vi.fn() }));
vi.mock("../../actions", () => ({ savePromptVersion: vi.fn() }));

const WORKSPACE_ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";

function renderDescribe(aiAvailable = true) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <DescribeTemplate
        workspaceId={WORKSPACE_ID}
        aiAvailable={aiAvailable}
        dailyLimit={20}
        cancelHref={`/espaces/${WORKSPACE_ID}/modeles/nouveau`}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DescribeTemplate, from the form", () => {
  it("builds the template from the answers and opens the editor on it", async () => {
    const user = userEvent.setup();
    renderDescribe();
    await user.type(screen.getByLabelText("Nom du modèle"), "Diagnostic du réseau");
    await user.type(
      screen.getByLabelText("Ce que la section doit contenir"),
      "Les fuites relevées, quartier par quartier, et leur coût.",
    );
    await user.type(screen.getByLabelText(/Structure attendue/), "Constats\nCoûts");
    await user.click(screen.getByRole("radio", { name: "Synthétique, en phrases courtes" }));
    await user.click(screen.getByRole("radio", { name: "Lister ce qui manque en fin de section" }));
    await user.click(screen.getByRole("button", { name: "Créer le texte du modèle" }));

    const heading = await screen.findByRole("heading", { name: "Relire et enregistrer le modèle" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText(/construit à partir de vos réponses/)).toBeInTheDocument();
    expect(screen.getByLabelText("Titre")).toHaveValue("Diagnostic du réseau");
    const template = screen.getByLabelText("Modèle", { selector: "textarea" }) as HTMLTextAreaElement;
    expect(template.value).toContain(
      "Contenu attendu :\nLes fuites relevées, quartier par quartier, et leur coût.",
    );
    expect(template.value).toContain("- Constats\n- Coûts");
    expect(template.value).toContain("Va à l'essentiel");
    expect(template.value).toContain("« Points à compléter »");
    expect(screen.getByLabelText("Note de version", { exact: false })).toHaveValue(
      "Créé avec le formulaire « Décrire le modèle ».",
    );
    // The type of result stays in view; the technical settings are folded.
    expect(screen.getByLabelText("Type de résultat")).toBeVisible();
    expect(screen.getByLabelText("Liberté de formulation")).not.toBeVisible();
    expect(screen.getByLabelText("Longueur maximale du texte")).not.toBeVisible();
    expect(writeTemplateWithAi).not.toHaveBeenCalled();
    expect(savePromptVersion).not.toHaveBeenCalled();
  });

  it("names what is missing and keeps the focus on the first field", async () => {
    const user = userEvent.setup();
    renderDescribe();
    await user.click(screen.getByRole("button", { name: "Créer le texte du modèle" }));
    expect(screen.getByText("Saisissez un nom de 2 à 200 caractères.")).toBeInTheDocument();
    expect(screen.getByText("Décrivez le contenu attendu en 10 à 1 500 caractères.")).toBeInTheDocument();
    expect(screen.getByLabelText("Nom du modèle")).toHaveFocus();
    expect(screen.queryByRole("heading", { name: "Relire et enregistrer le modèle" })).toBeNull();
  });

  it("goes back to the answers, which are kept", async () => {
    const user = userEvent.setup();
    renderDescribe();
    await user.type(screen.getByLabelText("Nom du modèle"), "Note de cadrage");
    await user.type(screen.getByLabelText("Ce que la section doit contenir"), "Le périmètre de la mission.");
    await user.click(screen.getByRole("button", { name: "Créer le texte du modèle" }));
    await user.click(await screen.findByRole("button", { name: "Revenir à la description" }));
    expect(screen.getByLabelText("Nom du modèle")).toHaveValue("Note de cadrage");
  });
});

describe("DescribeTemplate, with the AI", () => {
  it("fills the editor with what the AI wrote, and says what was fixed", async () => {
    vi.mocked(writeTemplateWithAi).mockResolvedValue({
      ok: true,
      title: "Synthèse des constats de terrain",
      description: "Une section sur les constats.",
      template: "Tu rédiges une section.\n\n{{deliverables}}",
      notes: ["unknownVariablesRemoved"],
      removed: ["{{client}}"],
    });
    const user = userEvent.setup();
    renderDescribe();
    await user.click(screen.getByRole("radio", { name: "Décrire en quelques phrases" }));
    expect(screen.getByText(/20 essais par personne et par jour/)).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Décrivez le modèle en quelques phrases"),
      "Une section qui présente les constats de terrain, avec leurs sources.",
    );
    await user.selectOptions(screen.getByLabelText("Type de résultat"), "recommendations");
    await user.click(screen.getByRole("button", { name: "Rédiger avec l'IA" }));

    await screen.findByRole("heading", { name: "Relire et enregistrer le modèle" });
    expect(writeTemplateWithAi).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      description: "Une section qui présente les constats de terrain, avec leurs sources.",
      outputSchema: "recommendations",
    });
    expect(screen.getByText(/rien n'est enregistré pour le moment/)).toBeInTheDocument();
    expect(screen.getByText(/variables qui n'existent pas \(\{\{client\}\}\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Titre")).toHaveValue("Synthèse des constats de terrain");
    expect(screen.getByLabelText("Type de résultat")).toHaveValue("recommendations");
    expect(screen.getByLabelText("Modèle", { selector: "textarea" })).toHaveValue(
      "Tu rédiges une section.\n\n{{deliverables}}",
    );
    expect(savePromptVersion).not.toHaveBeenCalled();
  });

  it("asks for a few sentences before calling the AI", async () => {
    const user = userEvent.setup();
    renderDescribe();
    await user.click(screen.getByRole("radio", { name: "Décrire en quelques phrases" }));
    await user.type(screen.getByLabelText("Décrivez le modèle en quelques phrases"), "Trop court");
    await user.click(screen.getByRole("button", { name: "Rédiger avec l'IA" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Décrivez le modèle en 20 caractères au moins.");
    expect(writeTemplateWithAi).not.toHaveBeenCalled();
  });

  it("says when the daily limit is reached", async () => {
    vi.mocked(writeTemplateWithAi).mockResolvedValue({
      ok: false,
      error: "rateLimited",
      retryAfter: 5 * 3600 - 10,
    });
    const user = userEvent.setup();
    renderDescribe();
    await user.click(screen.getByRole("radio", { name: "Décrire en quelques phrases" }));
    await user.type(
      screen.getByLabelText("Décrivez le modèle en quelques phrases"),
      "Une section sur les coûts de maintenance du réseau.",
    );
    await user.click(screen.getByRole("button", { name: "Rédiger avec l'IA" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vous avez atteint la limite du jour pour la rédaction avec l'IA. Réessayez dans 5 heures",
    );
  });

  it("is off, with the reason, when the server has no AI", () => {
    renderDescribe(false);
    expect(screen.getByRole("radio", { name: "Décrire en quelques phrases" })).toBeDisabled();
    expect(
      screen.getByText(/La rédaction avec l'IA n'est pas disponible pour le moment/),
    ).toBeInTheDocument();
  });
});

describe("DescribeTemplate, blank", () => {
  it("opens an empty editor for those who write the instructions themselves", async () => {
    const user = userEvent.setup();
    renderDescribe();
    await user.click(screen.getByRole("button", { name: "Partir d'un modèle vide" }));
    await screen.findByRole("heading", { name: "Relire et enregistrer le modèle" });
    expect(screen.getByLabelText("Modèle", { selector: "textarea" })).toHaveValue("");
  });
});
