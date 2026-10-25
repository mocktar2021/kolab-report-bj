import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleOutput } from "@/lib/ai/mock";
import { draftToMarkdown, type DraftOutput } from "@/lib/ai/schemas";
import type { DraftPanelData, DraftProposal, DraftTemplateOption } from "@/lib/ai/server";
import type { DeliverableUse } from "@/lib/ai/types";
import messages from "../../../../../../../../messages/fr.json";
import { acceptDraft, discardDraft, rateDraft } from "./draft-actions";
import { DraftPanel } from "./draft-panel";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode; className?: string }) => (
    <a href={`/fr${href}`} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("./draft-actions", () => ({ acceptDraft: vi.fn(), discardDraft: vi.fn(), rateDraft: vi.fn() }));

const WORKSPACE_ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";
const SECTION_ID = "6f1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
const GENERATION_ID = "9e8d7c6b-5a49-4382-9716-a5b4c3d2e1f0";
const UPDATED_AT = "2026-10-13T09:00:00.123456+00:00";

const GLOBAL_TEMPLATE: DraftTemplateOption = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Synthèse de section",
  description: "Un brouillon complet, avec les constats et les sources.",
  outputSchema: "section_draft",
  scope: "global",
};
const WORKSPACE_TEMPLATE: DraftTemplateOption = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Résumé pour le client",
  description: null,
  outputSchema: "executive_summary",
  scope: "workspace",
};

const DELIVERABLES: DeliverableUse[] = [
  {
    ref: "L1",
    id: "d1",
    fileName: "Rapport d'étude.docx",
    originalTokens: 1200,
    keptTokens: 1200,
    truncated: false,
    summarized: false,
    dropped: false,
    rowsCut: 0,
  },
  {
    ref: "L2",
    id: "d2",
    fileName: "Consommations.xlsx",
    originalTokens: 9000,
    keptTokens: 3000,
    truncated: true,
    summarized: false,
    dropped: false,
    rowsCut: 480,
  },
];
const NAMES = new Map(DELIVERABLES.map((use) => [use.ref, use.fileName]));
const OUTPUT: DraftOutput = { schema: "section_draft", value: sampleOutput("section_draft", ["L1", "L2"]) };
const MARKDOWN = draftToMarkdown(OUTPUT, NAMES);

function proposal(overrides: Partial<DraftProposal> = {}): DraftProposal {
  return {
    generationId: GENERATION_ID,
    createdAt: "2026-10-13T08:30:00.000000+00:00",
    templateTitle: "Synthèse de section",
    output: OUTPUT,
    markdown: MARKDOWN,
    truncated: false,
    deliverables: DELIVERABLES,
    rating: null,
    comment: null,
    mine: true,
    ...overrides,
  };
}

function panelData(overrides: Partial<DraftPanelData> = {}): DraftPanelData {
  return {
    availability: "enabled",
    templates: [GLOBAL_TEMPLATE, WORKSPACE_TEMPLATE],
    parsedCount: 2,
    proposal: null,
    content: null,
    sectionUpdatedAt: UPDATED_AT,
    ...overrides,
  };
}

function renderPanel(data: DraftPanelData = panelData(), manager = false) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <DraftPanel workspaceId={WORKSPACE_ID} sectionId={SECTION_ID} data={data} manager={manager} />
    </NextIntlClientProvider>,
  );
}

/** A draft response the test feeds event by event. The request's abort errors it, like a real one. */
function streamedResponse(signal?: AbortSignal | null) {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
  return {
    response: new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }),
    send: (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)),
    close: () => controller.close(),
  };
}

/** Stubs fetch with a streamed answer and returns its controls once the request is made. */
function stubStream() {
  let stream: ReturnType<typeof streamedResponse> | null = null;
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    stream = streamedResponse(init?.signal);
    return Promise.resolve(stream.response);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    get stream() {
      if (!stream) throw new Error("no request yet");
      return stream;
    },
  };
}

const START = { type: "start", generationId: GENERATION_ID, truncated: false, deliverables: DELIVERABLES };

/** The panel's status line, first of the live regions. */
function status() {
  return screen.getAllByRole("status")[0];
}

beforeEach(() => {
  router.refresh.mockReset();
  vi.mocked(acceptDraft).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(discardDraft).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(rateDraft).mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DraftPanel availability", () => {
  it("says drafts aren't configured, without a button", () => {
    renderPanel(panelData({ availability: "unconfigured" }));
    expect(
      screen.getByText("La génération de brouillons n'est pas configurée sur ce serveur."),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Générer un brouillon" })).toBeNull();
  });

  it("says drafts aren't switched on, without a button", () => {
    renderPanel(panelData({ availability: "disabled" }));
    expect(screen.getByText("La génération de brouillons n'est pas encore activée.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Générer un brouillon" })).toBeNull();
  });

  it("still shows a waiting proposal when drafts are off", () => {
    renderPanel(panelData({ availability: "disabled", proposal: proposal() }));
    expect(screen.getByRole("heading", { name: "Brouillon proposé" })).toBeVisible();
  });

  it("disables the button until a deliverable was read", () => {
    renderPanel(panelData({ parsedCount: 0 }));
    const button = screen.getByRole("button", { name: "Générer un brouillon" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      "Ajoutez d'abord un livrable que l'application a pu lire (statut « Analysé »).",
    );
  });

  it("sends managers to the template library when nothing is published", () => {
    renderPanel(panelData({ templates: [] }), true);
    expect(screen.getByRole("button", { name: "Générer un brouillon" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "bibliothèque de modèles" })).toHaveAttribute(
      "href",
      `/fr/espaces/${WORKSPACE_ID}/modeles`,
    );
  });

  it("tells other editors that managers publish templates", () => {
    renderPanel(panelData({ templates: [] }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByText(/Les propriétaires et les administrateurs de l'espace en publient/),
    ).toBeVisible();
  });
});

describe("DraftPanel template picker", () => {
  it("picks the first section draft template and describes it", async () => {
    const user = userEvent.setup();
    renderPanel();
    const select = screen.getByRole("combobox", { name: "Modèle de prompt" });
    expect(select).toHaveValue(GLOBAL_TEMPLATE.id);
    expect(within(select).getByRole("group", { name: "Modèles de l'espace" })).toBeInTheDocument();
    expect(within(select).getByRole("group", { name: "Modèles globaux" })).toBeInTheDocument();
    expect(select).toHaveAccessibleDescription(
      "Un brouillon complet, avec les constats et les sources. Résultat : Brouillon de section",
    );

    await user.selectOptions(select, WORKSPACE_TEMPLATE.id);
    expect(select).toHaveAccessibleDescription("Résultat : Résumé exécutif");
  });
});

describe("DraftPanel generation", () => {
  it("streams a draft into the preview, then shows the proposal", async () => {
    const user = userEvent.setup();
    const stub = stubStream();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Générer un brouillon" }));
    expect(stub.fetchMock).toHaveBeenCalledWith(
      `/api/ai/sections/${SECTION_ID}/draft`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ promptVersionId: GLOBAL_TEMPLATE.id }),
      }),
    );
    expect(status()).toHaveTextContent("Préparation du brouillon…");
    expect(screen.getByRole("button", { name: "Arrêter" })).toBeVisible();

    stub.stream.send({ ...START, truncated: true });
    stub.stream.send({ type: "partial", object: { title: "Brouillon", summary: "Le siège consom" } });
    expect(await screen.findByText("Le siège consom", { exact: false })).toBeVisible();
    expect(status()).toHaveTextContent("Rédaction du brouillon…");
    expect(screen.getByText(/Un livrable contient un tableau trop long/)).toBeVisible();
    expect(screen.getByText("(480 lignes de tableau coupées)", { exact: false })).toBeVisible();

    stub.stream.send({ type: "done", generationId: GENERATION_ID, output: OUTPUT, markdown: MARKDOWN });
    stub.stream.close();

    const heading = await screen.findByRole("heading", { name: "Brouillon proposé" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(status()).toHaveTextContent("Brouillon prêt. Relisez-le avant de l'accepter.");
    expect(screen.queryByRole("button", { name: "Arrêter" })).toBeNull();
    expect(screen.getByText(/Modèle « Synthèse de section », généré le/)).toBeVisible();
    expect(screen.getByRole("list", { name: "Livrables utilisés" })).toHaveTextContent(
      "Rapport d'étude.docx",
    );
    // The new proposal is the user's own: they can rate it.
    expect(screen.getByRole("button", { name: "Utile" })).toHaveAttribute("aria-pressed", "false");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("starts the preview over when the server repairs the draft", async () => {
    const user = userEvent.setup();
    const stub = stubStream();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Générer un brouillon" }));

    stub.stream.send(START);
    stub.stream.send({ type: "partial", object: { summary: "Premier essai" } });
    expect(await screen.findByText("Premier essai", { exact: false })).toBeVisible();

    stub.stream.send({ type: "repair" });
    await waitFor(() => expect(screen.queryByText("Premier essai", { exact: false })).toBeNull());
    expect(status()).toHaveTextContent(
      "Le brouillon ne suivait pas le format attendu. Deuxième essai en cours…",
    );
  });

  it("reports an error event and keeps the section as it was", async () => {
    const user = userEvent.setup();
    const stub = stubStream();
    renderPanel(panelData({ proposal: proposal({ generationId: "33333333-3333-4333-8333-333333333333" }) }));
    await user.click(screen.getByRole("button", { name: "Générer un brouillon" }));
    // The waiting proposal makes way for the preview.
    expect(screen.queryByRole("heading", { name: "Brouillon proposé" })).toBeNull();

    stub.stream.send(START);
    stub.stream.send({ type: "repair" });
    stub.stream.send({ type: "error", error: "invalidOutput" });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "L'IA n'a pas rendu un brouillon au format attendu, même au second essai.",
    );
    expect(alert).toHaveTextContent("Le contenu de la section n'a pas changé.");
    // The previous proposal is back.
    expect(screen.getByRole("heading", { name: "Brouillon proposé" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Générer un brouillon" })).toHaveFocus();
  });

  it("treats a stream that ends without done as a provider error", async () => {
    const user = userEvent.setup();
    const stub = stubStream();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Générer un brouillon" }));
    stub.stream.send(START);
    stub.stream.close();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Le service d'IA n'a pas répondu correctement.",
    );
  });

  it("shows when to try again after the hourly limit", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "rateLimited", retryAfter: 540 }, { status: 429 })),
    );
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Générer un brouillon" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vous avez demandé trop de brouillons en une heure. Réessayez dans 9 minutes.",
    );
  });

  it("sends people to next month once the budget is spent", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "budgetExceeded" }), {
            status: 429,
            headers: { "Retry-After": String(9 * 24 * 3600) },
          }),
      ),
    );
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Générer un brouillon" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "L'espace de travail a utilisé tout son budget d'IA pour ce mois. Réessayez le mois prochain.",
    );
  });

  it("gives the plan's allowance and when it comes back once the month's drafts are used", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "quotaExceeded",
              retryAfter: 9 * 24 * 3600,
              values: { max: 60, date: "1 novembre 2026" },
            }),
            { status: 402, headers: { "Retry-After": String(9 * 24 * 3600) } },
          ),
      ),
    );
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Générer un brouillon" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Les 60 brouillons IA du mois sont utilisés. Ajoutez un Pack IA ou attendez le 1 novembre 2026.",
    );
    expect(alert).not.toHaveTextContent("Réessayez");
  });

  it("says a read-only workspace gets no draft", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "readOnly" }, { status: 403 })),
    );
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Générer un brouillon" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cet espace de travail est en lecture seule : aucun brouillon ne peut être généré.",
    );
  });

  it("says when the request never reached the server", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Générer un brouillon" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La connexion a été coupée. Vérifiez votre réseau et réessayez.",
    );
  });

  it("stops a generation and leaves no proposal", async () => {
    const user = userEvent.setup();
    const stub = stubStream();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Générer un brouillon" }));
    stub.stream.send(START);
    stub.stream.send({ type: "partial", object: { summary: "Début" } });
    await screen.findByText("Début", { exact: false });

    await user.click(screen.getByRole("button", { name: "Arrêter" }));
    const signal = stub.fetchMock.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(true);
    expect(status()).toHaveTextContent("Génération arrêtée. Aucun brouillon n'a été enregistré.");
    expect(screen.queryByText("Début", { exact: false })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Brouillon proposé" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Générer un brouillon" })).toHaveFocus();
  });
});

describe("DraftPanel proposal", () => {
  it("shows the proposal with its template, date and sources", () => {
    renderPanel(panelData({ proposal: proposal({ truncated: true }) }));
    expect(screen.getByText("Modèle « Synthèse de section », généré le", { exact: false })).toBeVisible();
    expect(screen.getByText(/Un livrable contient un tableau trop long/)).toHaveTextContent(
      "Le détail par livrable est sous « Livrables utilisés ».",
    );
    const sources = screen.getByRole("list", { name: "Livrables utilisés" });
    expect(sources).toHaveTextContent("Consommations.xlsx (480 lignes de tableau coupées)");
    expect(screen.getByRole("tabpanel", { name: "Aperçu" })).toHaveTextContent("Contexte");
    expect(
      screen.getByText("Un brouillon attend déjà votre décision. Le nouveau le remplacera."),
    ).toBeVisible();
  });

  it("compares the proposal with the current content", async () => {
    const user = userEvent.setup();
    renderPanel(panelData({ proposal: proposal(), content: "Ancien texte de la section." }));

    const diffTab = screen.getByRole("tab", { name: "Différences" });
    screen.getByRole("tab", { name: "Aperçu" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(diffTab).toHaveFocus();
    expect(diffTab).toHaveAttribute("aria-selected", "true");

    const diff = within(screen.getByRole("tabpanel", { name: "Différences" })).getByRole("group", {
      name: "Lignes ajoutées et supprimées par rapport au contenu actuel",
    });
    expect(diff.querySelector("del")).toHaveTextContent("Supprimé : Ancien texte de la section.");
    expect(diff.querySelector("ins")).toHaveTextContent("Ajouté :");
  });

  it("says when the section has no content to compare with", async () => {
    const user = userEvent.setup();
    renderPanel(panelData({ proposal: proposal() }));
    await user.click(screen.getByRole("tab", { name: "Différences" }));
    expect(screen.getByText(/La section n'a pas encore de contenu/)).toBeVisible();
  });

  it("accepts the proposal as it is", async () => {
    const user = userEvent.setup();
    renderPanel(panelData({ proposal: proposal() }));
    await user.click(screen.getByRole("button", { name: "Accepter" }));

    expect(acceptDraft).toHaveBeenCalledWith({
      generationId: GENERATION_ID,
      content: MARKDOWN,
      sectionUpdatedAt: UPDATED_AT,
    });
    await waitFor(() =>
      expect(status()).toHaveTextContent(
        "Brouillon accepté. Il remplace maintenant le contenu de la section.",
      ),
    );
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Brouillon proposé" })).toBeNull();
  });

  it("accepts an edited text", async () => {
    const user = userEvent.setup();
    renderPanel(panelData({ proposal: proposal() }));
    await user.click(screen.getByRole("button", { name: "Modifier avant d'accepter" }));

    const textarea = screen.getByRole("textbox", { name: "Texte à accepter (Markdown)" });
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(textarea).toHaveValue(MARKDOWN);
    expect(textarea).toHaveAttribute("maxLength", "100000");

    await user.clear(textarea);
    expect(screen.getByRole("button", { name: "Accepter ce texte" })).toBeDisabled();
    await user.type(textarea, "Texte revu par l'expert.");
    await user.click(screen.getByRole("button", { name: "Accepter ce texte" }));

    expect(acceptDraft).toHaveBeenCalledWith({
      generationId: GENERATION_ID,
      content: "Texte revu par l'expert.",
      sectionUpdatedAt: UPDATED_AT,
    });
  });

  it("goes back to the review when editing is cancelled", async () => {
    const user = userEvent.setup();
    renderPanel(panelData({ proposal: proposal() }));
    await user.click(screen.getByRole("button", { name: "Modifier avant d'accepter" }));
    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("textbox", { name: "Texte à accepter (Markdown)" })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Modifier avant d'accepter" })).toHaveFocus(),
    );
  });

  it("asks before discarding", async () => {
    const user = userEvent.setup();
    renderPanel(panelData({ proposal: proposal() }));
    await user.click(screen.getByRole("button", { name: "Rejeter" }));

    expect(screen.getByText("Rejeter ce brouillon ? Le contenu de la section ne change pas.")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Annuler" })).toHaveFocus());
    expect(discardDraft).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirmer le rejet" }));
    expect(discardDraft).toHaveBeenCalledWith(GENERATION_ID);
    await waitFor(() =>
      expect(status()).toHaveTextContent("Brouillon rejeté. Le contenu de la section n'a pas changé."),
    );
    expect(screen.queryByRole("heading", { name: "Brouillon proposé" })).toBeNull();
  });

  it("asks to reload when the section changed meanwhile", async () => {
    const user = userEvent.setup();
    vi.mocked(acceptDraft).mockResolvedValue({ ok: false, error: "conflict" });
    renderPanel(panelData({ proposal: proposal() }));
    await user.click(screen.getByRole("button", { name: "Accepter" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("La section a changé depuis le chargement de la page.");
    expect(router.refresh).not.toHaveBeenCalled();
    await user.click(within(alert).getByRole("button", { name: "Recharger" }));
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Brouillon proposé" })).toBeVisible();
  });

  it("refreshes when someone else already decided", async () => {
    const user = userEvent.setup();
    vi.mocked(discardDraft).mockResolvedValue({ ok: false, error: "decided" });
    renderPanel(panelData({ proposal: proposal() }));
    await user.click(screen.getByRole("button", { name: "Rejeter" }));
    await user.click(screen.getByRole("button", { name: "Confirmer le rejet" }));

    await waitFor(() =>
      expect(status()).toHaveTextContent("Quelqu'un a déjà accepté ou rejeté ce brouillon."),
    );
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Brouillon proposé" })).toBeNull();
  });

  it("shows other decision errors", async () => {
    const user = userEvent.setup();
    vi.mocked(acceptDraft).mockRejectedValue(new Error("offline"));
    renderPanel(panelData({ proposal: proposal() }));
    await user.click(screen.getByRole("button", { name: "Accepter" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La décision n'a pas pu être enregistrée. Réessayez.",
    );
  });
});

describe("DraftPanel feedback", () => {
  it("saves a thumbs up and a comment", async () => {
    const user = userEvent.setup();
    renderPanel(panelData({ proposal: proposal() }));
    const send = screen.getByRole("button", { name: "Envoyer mon avis" });
    expect(send).toHaveAttribute("aria-disabled", "true");
    await user.click(send);
    expect(rateDraft).not.toHaveBeenCalled();

    const useful = screen.getByRole("button", { name: "Utile" });
    await user.click(useful);
    expect(useful).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Pas utile" }));
    expect(useful).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Pas utile" })).toHaveAttribute("aria-pressed", "true");
    await user.click(useful);

    await user.type(screen.getByRole("textbox", { name: "Commentaire (facultatif)" }), "  Clair et juste. ");
    await user.click(send);

    expect(rateDraft).toHaveBeenCalledWith({
      generationId: GENERATION_ID,
      rating: 1,
      comment: "Clair et juste.",
    });
    expect(await screen.findByText("Avis enregistré.")).toBeVisible();
    expect(send).toHaveAttribute("aria-disabled", "true");
    // Still focusable once saved, so the focus stays where it was.
    expect(send).toHaveFocus();
  });

  it("keeps the saved rating and comment", () => {
    renderPanel(panelData({ proposal: proposal({ rating: -1, comment: "Trop long." }) }));
    expect(screen.getByRole("button", { name: "Pas utile" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Commentaire (facultatif)" })).toHaveValue("Trop long.");
    expect(screen.getByText("Avis enregistré.")).toBeVisible();
  });

  it("shows why a rating failed", async () => {
    const user = userEvent.setup();
    vi.mocked(rateDraft).mockResolvedValue({ ok: false, error: "forbidden" });
    renderPanel(panelData({ proposal: proposal() }));
    await user.click(screen.getByRole("button", { name: "Utile" }));
    await user.click(screen.getByRole("button", { name: "Envoyer mon avis" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Seule la personne qui a demandé ce brouillon peut le noter.",
    );
  });

  it("is only for the person who asked for the draft", () => {
    renderPanel(panelData({ proposal: proposal({ mine: false }) }));
    expect(screen.queryByRole("button", { name: "Utile" })).toBeNull();
    expect(screen.getByRole("button", { name: "Accepter" })).toBeVisible();
  });
});
