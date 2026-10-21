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

async function openSwitcher(workspaces = WORKSPACES, onSearch?: () => void, onNavigate?: () => void) {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <WorkspaceSwitcher
        workspaces={workspaces}
        currentWorkspaceId={WORKSPACES[0]!.id}
        onSearch={onSearch}
        onNavigate={onNavigate}
      />
    </NextIntlClientProvider>,
  );
  screen.getByRole("button", { name: /^Espace de travail actuel : Mission Parakou/ }).focus();
  await user.keyboard("{Enter}");
  return { user, menu: await screen.findByRole("menu") };
}

// The button the page renders gives way to the menu's own once loaded (KRB-212).
const trigger = () => screen.getByRole("button", { name: /^Espace de travail actuel : Mission Parakou/ });

const agenceRow = (menu: HTMLElement) =>
  within(menu).getByRole("menuitem", { name: "Agence Ahouandjinou : 1 espace" });
const zinsouRow = (menu: HTMLElement) =>
  within(menu).getByRole("menuitem", { name: "Cabinet Zinsou : 2 espaces" });

describe("WorkspaceSwitcher (KRB-206)", () => {
  it("groups the workspaces under their organization, both sorted by name", async () => {
    const { user, menu } = await openSwitcher();
    await user.click(agenceRow(menu));
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
    await user.click(agenceRow(menu));
    await user.click(within(menu).getByRole("menuitemradio", { name: /Énergie Bénin/ }));
    expect(selectWorkspace).toHaveBeenCalledWith(WORKSPACES[1]!.id);
  });

  it("opens the workspace search once the menu has given the focus back", async () => {
    const onSearch = vi.fn();
    const { user, menu } = await openSwitcher(WORKSPACES, onSearch);
    await user.click(within(menu).getByRole("menuitem", { name: "Rechercher un espace" }));
    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    expect(trigger()).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("offers no search for a single workspace", async () => {
    const { menu } = await openSwitcher([WORKSPACES[0]!], vi.fn());
    expect(within(menu).queryByRole("menuitem", { name: "Rechercher un espace" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("group", { name: "Cabinet Zinsou" })).toBeVisible();
  });
});

describe("WorkspaceSwitcher organizations (KRB-209)", () => {
  it("opens only the current workspace's organization, and shows a count for each", async () => {
    const { menu } = await openSwitcher();
    expect(zinsouRow(menu)).toHaveAttribute("aria-expanded", "true");
    expect(zinsouRow(menu)).toHaveTextContent("Cabinet Zinsou : 2 espaces");
    expect(agenceRow(menu)).toHaveAttribute("aria-expanded", "false");
    expect(agenceRow(menu)).toHaveTextContent("Agence Ahouandjinou : 1 espace");
    expect(within(menu).queryByRole("group", { name: "Agence Ahouandjinou" })).not.toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(2);
  });

  it("opens and closes an organization on a click, and the menu stays open", async () => {
    const { user, menu } = await openSwitcher();
    await user.click(agenceRow(menu));
    expect(agenceRow(menu)).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByRole("menuitemradio", { name: /Énergie Bénin/ })).toBeVisible();
    await user.click(zinsouRow(menu));
    expect(zinsouRow(menu)).toHaveAttribute("aria-expanded", "false");
    expect(within(menu).queryByRole("menuitemradio", { name: /Mission Parakou/ })).not.toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeVisible();
    expect(selectWorkspace).not.toHaveBeenCalled();
  });

  it("opens with the right arrow and closes with the left arrow", async () => {
    const { user, menu } = await openSwitcher(WORKSPACES, vi.fn());
    expect(within(menu).getByRole("menuitem", { name: "Rechercher un espace" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(agenceRow(menu)).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(agenceRow(menu)).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitemradio", { name: /Énergie Bénin/ })).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowLeft}");
    expect(agenceRow(menu)).toHaveAttribute("aria-expanded", "false");
    expect(agenceRow(menu)).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(agenceRow(menu)).toHaveAttribute("aria-expanded", "true");
  });

  it("starts over each time the menu opens", async () => {
    const { user, menu } = await openSwitcher();
    await user.click(agenceRow(menu));
    await user.keyboard("{Escape}");
    trigger().focus();
    await user.keyboard("{Enter}");
    expect(agenceRow(await screen.findByRole("menu"))).toHaveAttribute("aria-expanded", "false");
  });

  it("does not fold a single organization", async () => {
    const { menu } = await openSwitcher([WORKSPACES[0]!, WORKSPACES[2]!]);
    expect(within(menu).queryByRole("menuitem", { expanded: false })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { expanded: true })).not.toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(2);
  });
});

describe("WorkspaceSwitcher reports of an organization (KRB-208)", () => {
  it("ends each open organization with a link to its reports", async () => {
    const { user, menu } = await openSwitcher();
    const zinsou = within(menu).getByRole("menuitem", { name: "Tous les rapports : Cabinet Zinsou" });
    expect(zinsou).toHaveAttribute("href", "/organisations/o-zinsou/rapports");
    expect(zinsou).toHaveTextContent("Tous les rapports");
    expect(
      within(menu).queryByRole("menuitem", { name: "Tous les rapports : Agence Ahouandjinou" }),
    ).not.toBeInTheDocument();
    await user.click(agenceRow(menu));
    expect(
      within(menu).getByRole("menuitem", { name: "Tous les rapports : Agence Ahouandjinou" }),
    ).toHaveAttribute("href", "/organisations/o-agence/rapports");
  });

  it("closes the mobile menu when it opens the reports", async () => {
    const onNavigate = vi.fn();
    const { user, menu } = await openSwitcher(WORKSPACES, undefined, onNavigate);
    const link = within(menu).getByRole("menuitem", { name: "Tous les rapports : Cabinet Zinsou" });
    // jsdom cannot follow a link: the test stops at the click.
    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(selectWorkspace).not.toHaveBeenCalled();
  });
});
