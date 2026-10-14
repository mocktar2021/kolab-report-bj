import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { NotificationItem } from "@/lib/notifications";
import type { ReportAction } from "@/lib/reports/status";
import messages from "../../../../../messages/fr.json";
import { NotificationList } from "./notification-list";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode; className?: string }) => (
    <a href={`/fr${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const NOW = "2026-10-14T10:00:00.000Z";
const WORKSPACE_ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";
const REPORT_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";

const TRANSITIONS: Record<ReportAction, Pick<NotificationItem, "from" | "to">> = {
  submit: { from: "draft", to: "in_review" },
  sendBack: { from: "in_review", to: "draft" },
  finalize: { from: "in_review", to: "final" },
  reopen: { from: "final", to: "draft" },
};

function notification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    createdAt: "2026-10-14T09:55:00.000000+00:00",
    read: false,
    workspaceId: WORKSPACE_ID,
    reportId: REPORT_ID,
    reportTitle: "Audit énergétique",
    from: "draft",
    to: "in_review",
    actorName: "Awa Dossou",
    ...overrides,
  };
}

function withIntl(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      {children}
    </NextIntlClientProvider>
  );
}

function renderList(notifications: NotificationItem[]) {
  return render(withIntl(<NotificationList notifications={notifications} now={NOW} />));
}

describe("NotificationList", () => {
  it.each([
    ["submit", "Awa Dossou a soumis « Audit énergétique » pour revue"],
    ["sendBack", "Awa Dossou a repassé « Audit énergétique » en brouillon"],
    ["finalize", "Awa Dossou a finalisé « Audit énergétique »"],
    ["reopen", "Awa Dossou a rouvert « Audit énergétique »"],
  ] as const)("names the person who made the %s change", (action, sentence) => {
    renderList([notification(TRANSITIONS[action])]);

    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it.each([
    ["submit", "Le rapport « Audit énergétique » a été soumis pour revue"],
    ["sendBack", "Le rapport « Audit énergétique » est repassé en brouillon"],
    ["finalize", "Le rapport « Audit énergétique » a été finalisé"],
    ["reopen", "Le rapport « Audit énergétique » a été rouvert"],
  ] as const)("words the %s change without a name when the person is gone", (action, sentence) => {
    renderList([notification({ ...TRANSITIONS[action], actorName: null })]);

    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it("links each notification to its report, newest first, with a relative or full date", () => {
    renderList([
      notification({ id: "aaaaaaaa-1111-4111-8111-111111111111" }),
      notification({
        id: "bbbbbbbb-2222-4222-8222-222222222222",
        createdAt: "2026-10-12T10:00:00.000000+00:00",
        reportId: "4d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a",
        reportTitle: "Bilan carbone",
        ...TRANSITIONS.finalize,
        read: true,
      }),
      notification({
        id: "cccccccc-3333-4333-8333-333333333333",
        createdAt: "2026-09-24T10:00:00.000000+00:00",
        ...TRANSITIONS.reopen,
        read: true,
      }),
    ]);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute("href", `/fr/rapports/${REPORT_ID}`);
    expect(links[0]).toHaveTextContent("Awa Dossou a soumis « Audit énergétique » pour revue");
    expect(within(links[0]!).getByText("il y a 5 minutes")).toHaveAttribute(
      "datetime",
      "2026-10-14T09:55:00.000000+00:00",
    );
    expect(links[1]).toHaveAttribute("href", "/fr/rapports/4d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a");
    expect(within(links[1]!).getByText("il y a 2 jours")).toBeInTheDocument();
    // Past a week, the day instead.
    expect(within(links[2]!).getByText("24 septembre 2026")).toBeInTheDocument();
  });

  it("marks unread notifications with a label, and keeps it while the page stays open", () => {
    const unread = notification({ id: "aaaaaaaa-1111-4111-8111-111111111111" });
    const read = notification({
      id: "bbbbbbbb-2222-4222-8222-222222222222",
      ...TRANSITIONS.finalize,
      read: true,
    });
    const { rerender, unmount } = renderList([unread, read]);

    const [first, second] = screen.getAllByRole("link");
    expect(first).toHaveTextContent("Non lue");
    expect(second).not.toHaveTextContent("Non lue");

    // The refresh after marking them as read brings read: true.
    rerender(withIntl(<NotificationList notifications={[{ ...unread, read: true }, read]} now={NOW} />));
    expect(screen.getAllByRole("link")[0]).toHaveTextContent("Non lue");
    unmount();

    // The next visit shows it as read.
    renderList([{ ...unread, read: true }, read]);
    expect(screen.queryByText("Non lue")).not.toBeInTheDocument();
  });

  it("says when there is nothing yet", () => {
    renderList([]);

    expect(screen.getByRole("heading", { level: 2, name: "Aucune notification" })).toBeInTheDocument();
    expect(
      screen.getByText("Quand un rapport auquel vous participez change de statut, vous le voyez ici."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
