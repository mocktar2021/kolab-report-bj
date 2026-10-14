import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../messages/fr.json";
import { NotificationBell } from "./notification-bell";

const navigation = vi.hoisted(() => ({ pathname: "/tableau-de-bord" }));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode; className?: string }) => (
    <a href={`/fr${href}`} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => navigation.pathname,
}));

function renderBell(unread: number) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <NotificationBell unread={unread} />
    </NextIntlClientProvider>,
  );
}

describe("NotificationBell", () => {
  it("links to the notifications page with the unread count in its label and badge", () => {
    renderBell(3);

    const bell = screen.getByRole("link", { name: "Notifications, 3 non lues" });
    expect(bell).toHaveAttribute("href", "/fr/notifications");
    expect(bell).toHaveTextContent(/^3$/);
    expect(bell).not.toHaveAttribute("aria-current");
  });

  it("uses the singular for one unread notification", () => {
    renderBell(1);

    expect(screen.getByRole("link", { name: "Notifications, 1 non lue" })).toHaveTextContent(/^1$/);
  });

  it("shows 9 at nine and 9+ past it, with the exact count in the label", () => {
    const { unmount } = renderBell(9);
    expect(screen.getByRole("link", { name: "Notifications, 9 non lues" })).toHaveTextContent(/^9$/);
    unmount();

    renderBell(12);
    expect(screen.getByRole("link", { name: "Notifications, 12 non lues" })).toHaveTextContent(/^9\+$/);
  });

  it("hides the badge when everything is read", () => {
    renderBell(0);

    const bell = screen.getByRole("link", { name: "Notifications" });
    expect(bell.textContent).toBe("");
  });

  it("marks itself as the current page on the notifications page", () => {
    navigation.pathname = "/notifications";
    renderBell(0);

    expect(screen.getByRole("link", { name: "Notifications" })).toHaveAttribute("aria-current", "page");
    navigation.pathname = "/tableau-de-bord";
  });
});
