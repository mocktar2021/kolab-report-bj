import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/fr.json";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { WorkspaceSwitcher } from "./workspace-switcher";

const selectWorkspace = vi.fn();
vi.mock("@/lib/workspaces/actions", () => ({ selectWorkspace: (id: string) => selectWorkspace(id) }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const WORKSPACES: MyWorkspace[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Mission Parakou",
    organizationId: "o-zinsou",
    organizationName: "Cabinet Zinsou",
    ownsOrganization: true,
    role: "owner",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Énergie Bénin",
    organizationId: "o-agence",
    organizationName: "Agence Ahouandjinou",
    ownsOrganization: false,
    role: "expert",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Audit Abomey",
    organizationId: "o-zinsou",
    organizationName: null,
    ownsOrganization: true,
    role: "admin",
  },
];

// The menu positions itself with ResizeObserver, which jsdom does not have.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => selectWorkspace.mockReset());

async function openSwitcher(workspaces = WORKSPACES, onSearch?: () => void) {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <WorkspaceSwitcher workspaces={workspaces} currentWorkspaceId={WORKSPACES[0]!.id} onSearch={onSearch} />
    </NextIntlClientProvider>,
  );
  const trigger = screen.getByRole("button", { name: /^Espace de travail actuel : Mission Parakou/ });
  trigger.focus();
  await user.keyboard("{Enter}");
  return { user, menu: await screen.findByRole("menu"), trigger };
}

describe("WorkspaceSwitcher (KRB-206)", () => {
  it("groups the workspaces under their organization, both sorted by name", async () => {
    const { menu } = await openSwitcher();
    const agence = within(menu).getByRole("group", { name: "Agence Ahouandjinou" });
    const zinsou = within(menu).getByRole("group", { name: "Cabinet Zinsou" });
    expect(
      within(agence)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["Énergie BéninExpert"]);
    expect(
      within(zinsou)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["Audit AbomeyAdministrateur", "Mission ParakouPropriétaire"]);
    expect(within(zinsou).getByRole("menuitemradio", { name: /Mission Parakou/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("switches to the workspace chosen", async () => {
    const { user, menu } = await openSwitcher();
    await user.click(within(menu).getByRole("menuitemradio", { name: /Énergie Bénin/ }));
    expect(selectWorkspace).toHaveBeenCalledWith(WORKSPACES[1]!.id);
  });

  it("opens the workspace search once the menu has given the focus back", async () => {
    const onSearch = vi.fn();
    const { user, menu, trigger } = await openSwitcher(WORKSPACES, onSearch);
    await user.click(within(menu).getByRole("menuitem", { name: "Rechercher un espace" }));
    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("offers no search for a single workspace", async () => {
    const { menu } = await openSwitcher([WORKSPACES[0]!], vi.fn());
    expect(within(menu).queryByRole("menuitem", { name: "Rechercher un espace" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("group", { name: "Cabinet Zinsou" })).toBeVisible();
  });
});
