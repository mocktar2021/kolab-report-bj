import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/fr.json";
import { ExportButtons } from "./export-buttons";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const REPORT_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";
const EXPORT_ID = "9e8d7c6b-5a49-4382-9716-a5b4c3d2e1f0";

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderButtons(onDownload = vi.fn()) {
  render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <ExportButtons reportId={REPORT_ID} hourlyLimit={20} onDownload={onDownload} />
    </NextIntlClientProvider>,
  );
  return {
    onDownload,
    docx: screen.getByRole("button", { name: "Exporter en .docx" }),
    pdf: screen.getByRole("button", { name: "Exporter en PDF" }),
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  router.refresh.mockReset();
});

describe("ExportButtons", () => {
  it("posts the format, waits on both buttons, then starts the download", async () => {
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const user = userEvent.setup();
    const { onDownload, docx, pdf } = renderButtons();

    await user.click(docx);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/reports/${REPORT_ID}/exports`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ format: "docx", withAnnexes: true });

    expect(docx).toHaveAttribute("aria-disabled", "true");
    expect(pdf).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Préparation du fichier.");

    // A click while the file is being built sends nothing.
    await user.click(pdf);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () =>
      answer(
        json(201, {
          id: EXPORT_ID,
          fileName: "audit-du-siege-2026-10-14.docx",
          url: `/api/exports/${EXPORT_ID}`,
        }),
      ),
    );

    await waitFor(() => expect(onDownload).toHaveBeenCalledWith(`/api/exports/${EXPORT_ID}`));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Fichier audit-du-siege-2026-10-14.docx prêt, le téléchargement commence.",
    );
    expect(docx).toHaveAttribute("aria-disabled", "false");
    expect(pdf).toHaveAttribute("aria-disabled", "false");
  });

  it("asks for a PDF with the other button", async () => {
    fetchMock.mockResolvedValue(
      json(201, { id: EXPORT_ID, fileName: "audit-2026-10-14.pdf", url: `/api/exports/${EXPORT_ID}` }),
    );
    const user = userEvent.setup();
    const { onDownload, pdf } = renderButtons();

    await user.click(pdf);

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      format: "pdf",
      withAnnexes: true,
    });
    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1));
  });

  it("asks for the list of files in annex until the box is unticked from the keyboard", async () => {
    fetchMock.mockResolvedValue(
      json(201, { id: EXPORT_ID, fileName: "audit-2026-10-14.pdf", url: `/api/exports/${EXPORT_ID}` }),
    );
    const user = userEvent.setup();
    const { pdf } = renderButtons();
    const box = screen.getByRole("checkbox", { name: "Inclure la liste des livrables en annexe" });
    expect(box).toBeChecked();

    box.focus();
    await user.keyboard(" ");
    expect(box).not.toBeChecked();
    await user.click(pdf);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      format: "pdf",
      withAnnexes: false,
    });

    // Ticked again, the next export has the annexes.
    await user.click(screen.getByText("Inclure la liste des livrables en annexe"));
    expect(box).toBeChecked();
    await waitFor(() => expect(pdf).toHaveAttribute("aria-disabled", "false"));
    await user.click(pdf);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      format: "pdf",
      withAnnexes: true,
    });
  });

  it("says when the hourly limit is reached", async () => {
    fetchMock.mockResolvedValue(json(429, { error: "rateLimited" }));
    const user = userEvent.setup();
    const { onDownload, docx } = renderButtons();

    await user.click(docx);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Vous avez atteint la limite de 20 exports par heure dans cet espace. Réessayez plus tard.",
      ),
    );
    expect(onDownload).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(docx).toHaveAttribute("aria-disabled", "false");
  });

  it("says when another export of the person is still running", async () => {
    fetchMock.mockResolvedValue(json(409, { error: "busy" }));
    const user = userEvent.setup();
    const { docx } = renderButtons();

    await user.click(docx);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Vous avez déjà un export en cours dans cet espace. Attendez qu'il se termine puis réessayez.",
      ),
    );
  });

  it("suggests the .docx export when a report is too long for a PDF", async () => {
    fetchMock.mockResolvedValue(json(413, { error: "tooLarge" }));
    const user = userEvent.setup();
    const { onDownload, pdf } = renderButtons();

    await user.click(pdf);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Ce rapport est trop long pour un PDF. Exportez-le en .docx, qui accepte des rapports plus longs.",
      ),
    );
    expect(onDownload).not.toHaveBeenCalled();
  });

  it.each([
    [403, null, "Seuls les propriétaires et administrateurs peuvent exporter ce rapport."],
    [415, { error: "invalidInput" }, "La demande d'export n'est pas valide."],
    [404, { error: "notFound" }, "Ce rapport n'existe plus ou ne vous est plus accessible."],
    [500, { error: "generic" }, "L'export n'a pas abouti. Réessayez dans un instant."],
    [502, "<html>", "L'export n'a pas abouti."],
  ])("maps a %i answer to its French message", async (status, body, message) => {
    fetchMock.mockResolvedValue(json(status, body));
    const user = userEvent.setup();
    const { docx } = renderButtons();

    await user.click(docx);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(message));
  });

  it("does not follow a link that is not an export download", async () => {
    fetchMock.mockResolvedValue(
      json(201, { id: EXPORT_ID, fileName: "x.docx", url: "https://evil.example" }),
    );
    const user = userEvent.setup();
    const { onDownload, docx } = renderButtons();

    await user.click(docx);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("L'export n'a pas abouti."));
    expect(onDownload).not.toHaveBeenCalled();
  });

  it("shows the generic message when the request fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    const { docx } = renderButtons();

    await user.click(docx);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("L'export n'a pas abouti."));
  });
});
