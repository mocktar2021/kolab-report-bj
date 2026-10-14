import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedReportActions, type ReportStatus } from "@/lib/reports/status";
import type { FinalSnapshot } from "@/lib/reports/workflow";
import type { WorkspaceRole } from "@/lib/workspaces/roles";
import messages from "../../../../../../messages/fr.json";
import { ReportStatusControls } from "./report-status-controls";
import { changeReportStatus, retryFinalSnapshot, type ReportStatusState } from "./status-actions";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./status-actions", () => ({
  changeReportStatus: vi.fn(),
  retryFinalSnapshot: vi.fn(),
}));

const REPORT_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";

function renderControls({
  status,
  role = "owner",
  snapshot = null,
}: {
  status: ReportStatus;
  role?: WorkspaceRole;
  snapshot?: FinalSnapshot | null;
}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <ReportStatusControls
        reportId={REPORT_ID}
        status={status}
        actions={allowedReportActions(status, role)}
        snapshot={snapshot}
      />
    </NextIntlClientProvider>,
  );
}

function panel() {
  return screen.getByRole("region", { name: "Revue et finalisation" });
}

function feedback() {
  const status = within(panel())
    .getAllByRole("status")
    .find((element) => element.parentElement?.querySelector("#report-status-title"));
  if (!status) throw new Error("missing status message");
  return status;
}

/** What the form sent to the server action, as a plain object. */
function sent(mock: ReturnType<typeof vi.fn>) {
  const formData = mock.mock.calls[0]?.[1] as FormData | undefined;
  return formData ? Object.fromEntries(formData.entries()) : null;
}

afterEach(() => {
  vi.mocked(changeReportStatus).mockReset();
  vi.mocked(retryFinalSnapshot).mockReset();
  router.refresh.mockReset();
});

describe("ReportStatusControls buttons", () => {
  it.each([
    ["draft", "owner", ["Soumettre pour revue"]],
    ["draft", "admin", ["Soumettre pour revue"]],
    ["in_review", "owner", ["Repasser en brouillon", "Finaliser"]],
    ["in_review", "admin", ["Repasser en brouillon"]],
    ["final", "owner", ["Rouvrir en brouillon"]],
    ["final", "admin", []],
  ] as const)("shows %s actions for an %s", (status, role, labels) => {
    renderControls({ status, role, snapshot: status === "final" ? { state: "pending" } : null });

    const buttons = within(panel())
      .queryAllByRole("button")
      .map((button) => button.textContent);
    expect(buttons).toEqual(labels);
  });

  it("tells an admin that only an owner finalizes or reopens", () => {
    renderControls({ status: "in_review", role: "admin" });
    expect(
      within(panel()).getByText("Seul un propriétaire peut finaliser le rapport ou le rouvrir en brouillon."),
    ).toBeVisible();
  });

  it("does not show that note to an owner", () => {
    renderControls({ status: "in_review", role: "owner" });
    expect(within(panel()).queryByText(/Seul un propriétaire/)).toBeNull();
  });
});

describe("ReportStatusControls submit", () => {
  it("submits for review without a confirmation, with the report and the action", async () => {
    vi.mocked(changeReportStatus).mockResolvedValue({ status: "success", to: "in_review", snapshot: null });
    const user = userEvent.setup();
    renderControls({ status: "draft" });

    const button = screen.getByRole("button", { name: "Soumettre pour revue" });
    const form = button.closest("form");
    expect(form?.querySelector('input[type="hidden"][name="reportId"]')).toHaveValue(REPORT_ID);
    expect(form?.querySelector('input[type="hidden"][name="action"]')).toHaveValue("submit");

    await user.click(button);

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(feedback()).toHaveTextContent("Le rapport est en revue. Les membres concernés sont prévenus."),
    );
    expect(changeReportStatus).toHaveBeenCalledTimes(1);
    expect(sent(vi.mocked(changeReportStatus))).toEqual({ reportId: REPORT_ID, action: "submit" });
  });
});

describe("ReportStatusControls confirmation", () => {
  it("asks before finalizing and says what it does", async () => {
    const user = userEvent.setup();
    renderControls({ status: "in_review" });

    const trigger = screen.getByRole("button", { name: "Finaliser" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Finaliser le rapport ?" });
    expect(dialog).toHaveAccessibleDescription(/lecture seule pour tout le monde, propriétaires compris/);
    expect(dialog).toHaveAccessibleDescription(/Un PDF de la version finale est enregistré/);
    expect(dialog.querySelector('input[type="hidden"][name="reportId"]')).toHaveValue(REPORT_ID);
    expect(dialog.querySelector('input[type="hidden"][name="action"]')).toHaveValue("finalize");
    expect(changeReportStatus).not.toHaveBeenCalled();
  });

  it("changes nothing when the dialog is cancelled, and gives the focus back", async () => {
    const user = userEvent.setup();
    renderControls({ status: "in_review" });

    const trigger = screen.getByRole("button", { name: "Repasser en brouillon" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Repasser le rapport en brouillon ?" });
    expect(dialog.querySelector('input[name="action"]')).toHaveValue("sendBack");

    await user.click(within(dialog).getByRole("button", { name: "Annuler" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(changeReportStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("finalizes on confirm and reports the stored final version", async () => {
    vi.mocked(changeReportStatus).mockResolvedValue({ status: "success", to: "final", snapshot: "ready" });
    const user = userEvent.setup();
    renderControls({ status: "in_review" });

    await user.click(screen.getByRole("button", { name: "Finaliser" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Finaliser le rapport" }),
    );

    await waitFor(() => expect(feedback()).toHaveTextContent("Le rapport est final."));
    expect(feedback()).toHaveTextContent("La version finale est enregistrée.");
    expect(sent(vi.mocked(changeReportStatus))).toEqual({ reportId: REPORT_ID, action: "finalize" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("waits on the finalization, then puts the focus on the result once the button is gone", async () => {
    let finish: (state: ReportStatusState) => void = () => {};
    vi.mocked(changeReportStatus).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    const view = renderControls({ status: "in_review" });

    await user.click(screen.getByRole("button", { name: "Finaliser" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Finaliser le rapport" }),
    );

    await waitFor(() => expect(feedback()).toHaveTextContent(/Finalisation du rapport et création/));
    // The dialog does not wait for the answer.
    expect(screen.queryByRole("dialog")).toBeNull();
    for (const button of within(panel()).getAllByRole("button")) {
      expect(button).toHaveAttribute("aria-disabled", "true");
    }

    // The action answers with the page data: the report is final now.
    await act(async () => finish({ status: "success", to: "final", snapshot: "ready" }));
    view.rerender(
      <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
        <ReportStatusControls
          reportId={REPORT_ID}
          status="final"
          actions={allowedReportActions("final", "owner")}
          snapshot={{ state: "ready", url: "/api/exports/abc", fileName: "audit.pdf" }}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.queryByRole("button", { name: "Finaliser" })).toBeNull();
    await waitFor(() => expect(feedback()).toHaveFocus());
    expect(feedback()).toHaveTextContent("Le rapport est final.");
  });

  it("says when the final version could not be stored", async () => {
    vi.mocked(changeReportStatus).mockResolvedValue({ status: "success", to: "final", snapshot: "failed" });
    const user = userEvent.setup();
    renderControls({ status: "in_review" });

    await user.click(screen.getByRole("button", { name: "Finaliser" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Finaliser le rapport" }),
    );

    await waitFor(() =>
      expect(feedback()).toHaveTextContent(
        "La version finale n'a pas pu être enregistrée. Utilisez « Créer la version finale » pour réessayer.",
      ),
    );
  });

  it("says that reopening makes the sections editable again", async () => {
    vi.mocked(changeReportStatus).mockResolvedValue({ status: "success", to: "draft", snapshot: null });
    const user = userEvent.setup();
    renderControls({ status: "final", snapshot: { state: "pending" } });

    await user.click(screen.getByRole("button", { name: "Rouvrir en brouillon" }));
    const dialog = screen.getByRole("dialog", { name: "Rouvrir le rapport en brouillon ?" });
    expect(dialog).toHaveAccessibleDescription(/redeviennent modifiables/);

    await user.click(within(dialog).getByRole("button", { name: "Rouvrir en brouillon" }));

    await waitFor(() =>
      expect(feedback()).toHaveTextContent(
        "Le rapport est rouvert en brouillon. Ses sections sont de nouveau modifiables.",
      ),
    );
    expect(sent(vi.mocked(changeReportStatus))).toEqual({ reportId: REPORT_ID, action: "reopen" });
  });
});

describe("ReportStatusControls errors", () => {
  it("reloads the page when another session changed the status first", async () => {
    vi.mocked(changeReportStatus).mockResolvedValue({ status: "error", error: "stale" });
    const user = userEvent.setup();
    renderControls({ status: "draft" });

    await user.click(screen.getByRole("button", { name: "Soumettre pour revue" }));

    await waitFor(() => expect(feedback()).toHaveTextContent(/a changé dans une autre session/));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("explains a refused change", async () => {
    vi.mocked(changeReportStatus).mockResolvedValue({ status: "error", error: "forbidden" });
    const user = userEvent.setup();
    renderControls({ status: "draft", role: "admin" });

    await user.click(screen.getByRole("button", { name: "Soumettre pour revue" }));

    await waitFor(() =>
      expect(feedback()).toHaveTextContent("Vous n'avez pas les droits pour ce changement."),
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("ReportStatusControls final version", () => {
  it("links to the stored file, with its format", () => {
    renderControls({
      status: "final",
      snapshot: { state: "ready", url: "/api/exports/abc", fileName: "audit-2026-10-14.pdf" },
    });

    const link = screen.getByRole("link", { name: "Version finale (PDF)" });
    expect(link).toHaveAttribute("href", "/api/exports/abc");
    expect(within(panel()).getByText("audit-2026-10-14.pdf")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Créer la version finale" })).toBeNull();
  });

  it("names a .docx final version as such", () => {
    renderControls({
      status: "final",
      snapshot: { state: "ready", url: "/api/exports/abc", fileName: "audit-2026-10-14.docx" },
    });
    expect(screen.getByRole("link", { name: "Version finale (.docx)" })).toBeVisible();
  });

  it("says when the final version is being stored", () => {
    renderControls({ status: "final", role: "admin", snapshot: { state: "pending" } });
    expect(within(panel()).getByText(/est en cours de création/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Créer la version finale" })).toBeNull();
  });

  it("lets a manager store a missing final version again", async () => {
    vi.mocked(retryFinalSnapshot).mockResolvedValue({ status: "done", snapshot: "ready" });
    const user = userEvent.setup();
    renderControls({ status: "final", role: "admin", snapshot: { state: "missing" } });

    expect(within(panel()).getByText("La version finale (PDF) n'a pas été enregistrée.")).toBeVisible();
    const button = screen.getByRole("button", { name: "Créer la version finale" });
    expect(button.closest("form")?.querySelector('input[type="hidden"][name="reportId"]')).toHaveValue(
      REPORT_ID,
    );

    await user.click(button);

    await waitFor(() =>
      expect(within(panel()).getByText("La version finale est enregistrée.")).toBeVisible(),
    );
    expect(sent(vi.mocked(retryFinalSnapshot))).toEqual({ reportId: REPORT_ID });
    expect(changeReportStatus).not.toHaveBeenCalled();
  });
});
