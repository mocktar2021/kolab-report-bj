import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/fr.json";
import { markNotificationsRead } from "./actions";
import { MarkShownRead, OlderUnread } from "./mark-read";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@/i18n/navigation", () => ({ useRouter: () => router }));
vi.mock("./actions", () => ({ markNotificationsRead: vi.fn() }));

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const C = "cccccccc-3333-4333-8333-333333333333";
const D = "dddddddd-4444-4444-8444-444444444444";

function withIntl(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      {children}
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.mocked(markNotificationsRead).mockResolvedValue({ ok: true });
});

describe("MarkShownRead", () => {
  it("marks only the unread notifications as read, then refreshes the page", async () => {
    render(
      <MarkShownRead
        notifications={[
          { id: A, read: false },
          { id: B, read: true },
          { id: C, read: false },
        ]}
      />,
    );

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(markNotificationsRead).toHaveBeenCalledTimes(1);
    expect(markNotificationsRead).toHaveBeenCalledWith([A, C]);
  });

  it("does nothing when everything is read", async () => {
    render(<MarkShownRead notifications={[{ id: B, read: true }]} />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(markNotificationsRead).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("sends each id once, and only the new ones after a refresh", async () => {
    const { rerender } = render(<MarkShownRead notifications={[{ id: A, read: false }]} />);
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));

    // The refresh brings A as read and a notification that came in meanwhile.
    rerender(
      <MarkShownRead
        notifications={[
          { id: D, read: false },
          { id: A, read: true },
        ]}
      />,
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(2));

    expect(markNotificationsRead).toHaveBeenCalledTimes(2);
    expect(markNotificationsRead).toHaveBeenNthCalledWith(1, [A]);
    expect(markNotificationsRead).toHaveBeenNthCalledWith(2, [D]);
  });

  it("leaves the page as it is when the update fails", async () => {
    vi.mocked(markNotificationsRead).mockResolvedValue({ ok: false });
    render(<MarkShownRead notifications={[{ id: A, read: false }]} />);

    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledWith([A]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("OlderUnread", () => {
  it("marks every notification as read on request", async () => {
    const user = userEvent.setup();
    render(withIntl(<OlderUnread count={3} />));

    expect(screen.getByText("3 notifications plus anciennes ne sont pas encore lues.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tout marquer comme lu" }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(markNotificationsRead).toHaveBeenCalledWith();
  });

  it("says so when the update fails", async () => {
    vi.mocked(markNotificationsRead).mockResolvedValue({ ok: false });
    const user = userEvent.setup();
    render(withIntl(<OlderUnread count={1} />));

    expect(screen.getByText("1 notification plus ancienne n'est pas encore lue.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tout marquer comme lu" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Les notifications n'ont pas pu être marquées comme lues. Réessayez.",
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
