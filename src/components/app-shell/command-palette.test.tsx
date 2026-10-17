import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/fr.json";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { CommandPalette, type PaletteScope } from "./command-palette";

const selectWorkspace = vi.fn();
vi.mock("@/lib/workspaces/actions", () => ({ selectWorkspace: (id: string) => selectWorkspace(id) }));
vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
    organizationName: "Cabinet Zinsou",
    ownsOrganization: true,
    role: "owner",
  },
];

// cmdk and the dialog use browser APIs jsdom does not have.
const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = () => {};
});
afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});
beforeEach(() => selectWorkspace.mockReset());

function renderPalette(scope: PaletteScope, workspaces = WORKSPACES) {
  const onOpenChange = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        scope={scope}
        workspaces={workspaces}
        currentWorkspaceId={WORKSPACES[0]!.id}
      />
    </NextIntlClientProvider>,
  );
  return { onOpenChange, user: userEvent.setup() };
}

/** The text a screen reader reads: without the aria-hidden initials. */
function spoken(element: HTMLElement) {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[aria-hidden='true']").forEach((node) => node.remove());
  return copy.textContent;
}

const optionNames = () => screen.queryAllByRole("option").map(spoken);

describe("CommandPalette, workspace search (KRB-206)", () => {
  it("lists the workspaces under their organization, both sorted by name", () => {
    renderPalette("workspaces");
    expect(screen.getByRole("dialog", { name: "Rechercher un espace de travail" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Rechercher un espace de travail" })).toHaveFocus();

    const agence = screen.getByRole("group", { name: "Agence Ahouandjinou" });
    const zinsou = screen.getByRole("group", { name: "Cabinet Zinsou" });
    expect(within(agence).getAllByRole("option").map(spoken)).toEqual(["Énergie Bénin"]);
    expect(within(zinsou).getAllByRole("option").map(spoken)).toEqual([
      "Audit Abomey",
      "Mission ParakouEspace actuel",
    ]);
    // Only workspaces: no navigation, filters or theme.
    expect(screen.queryByRole("option", { name: "Aller au tableau de bord" })).not.toBeInTheDocument();
  });

  it("finds a workspace without its accents or capitals", async () => {
    const { user } = renderPalette("workspaces");
    await user.type(screen.getByRole("combobox"), "energie");
    expect(optionNames()).toEqual(["Énergie Bénin"]);
  });

  it("finds every workspace of an organization by its name", async () => {
    const { user } = renderPalette("workspaces");
    await user.type(screen.getByRole("combobox"), "zinsou");
    expect(optionNames()).toEqual(["Audit Abomey", "Mission ParakouEspace actuel"]);
    expect(screen.getByRole("group", { name: "Cabinet Zinsou" })).toBeVisible();
  });

  it("switches to the workspace chosen with the keyboard and closes", async () => {
    const { user, onOpenChange } = renderPalette("workspaces");
    await user.type(screen.getByRole("combobox"), "bénin");
    await user.keyboard("{Enter}");
    expect(selectWorkspace).toHaveBeenCalledWith(WORKSPACES[1]!.id);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says so when nothing matches", async () => {
    const { user } = renderPalette("workspaces");
    await user.type(screen.getByRole("combobox"), "kandi");
    expect(screen.getByText("Aucun espace ne correspond à votre recherche.")).toBeVisible();
    expect(optionNames()).toEqual([]);
  });
});

describe("CommandPalette, all actions", () => {
  it("adds the workspaces, with their organization, next to the other actions", async () => {
    const { user } = renderPalette("all");
    expect(screen.getByRole("dialog", { name: "Palette de commandes" })).toBeVisible();
    const group = screen.getByRole("group", { name: "Espaces de travail" });
    expect(within(group).getAllByRole("option").map(spoken)).toEqual([
      "Énergie BéninAgence Ahouandjinou",
      "Audit AbomeyCabinet Zinsou",
      "Mission ParakouCabinet ZinsouEspace actuel",
    ]);

    await user.type(screen.getByRole("combobox", { name: "Rechercher une action ou un espace" }), "parakou");
    expect(optionNames()).toEqual(["Mission ParakouCabinet ZinsouEspace actuel"]);
  });

  it("leaves the workspaces out with only one", () => {
    renderPalette("all", [WORKSPACES[0]!]);
    expect(screen.queryByRole("group", { name: "Espaces de travail" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Aller au tableau de bord" })).toBeVisible();
  });

  it("still finds an action typed without accents", async () => {
    const { user } = renderPalette("all");
    await user.type(screen.getByRole("combobox"), "theme sombre");
    expect(optionNames()[0]).toBe("Passer au thème sombre");
  });
});
