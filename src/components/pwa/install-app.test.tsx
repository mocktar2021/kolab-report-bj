import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/fr.json";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

// lib/pwa/install keeps the browser's event in module state: each test loads
// fresh copies of it and of the button.
async function renderButton() {
  vi.resetModules();
  const { InstallAppButton } = await import("./install-app");
  render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <InstallAppButton className="install" />
    </NextIntlClientProvider>,
  );
  return userEvent.setup();
}

function fireInstallEvent() {
  const prompt = vi.fn(() => Promise.resolve());
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome: "accepted" as const, platform: "web" }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return prompt;
}

const installButton = () => screen.queryByRole("button", { name: "Installer l'application" });

beforeEach(() => {
  window.matchMedia = vi.fn(() => ({ matches: false }) as MediaQueryList);
});
afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

describe("InstallAppButton (KRB-205)", () => {
  it("shows nothing until the browser says the app can be installed", async () => {
    await renderButton();
    expect(installButton()).not.toBeInTheDocument();
  });

  it("opens the browser's install dialog, then hides", async () => {
    const user = await renderButton();
    const prompt = fireInstallEvent();
    await user.click(installButton()!);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(installButton()).not.toBeInTheDocument();
  });

  it("hides once the app is installed", async () => {
    await renderButton();
    fireInstallEvent();
    expect(installButton()).toBeVisible();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(installButton()).not.toBeInTheDocument();
  });

  it("shows the share menu steps on an iPhone and gives the focus back on close", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(IPHONE);
    const user = await renderButton();
    const button = installButton()!;
    expect(button).toHaveAttribute("aria-haspopup", "dialog");

    await user.click(button);
    const dialog = screen.getByRole("dialog", { name: "Installer KolabReport" });
    expect(dialog).toHaveAccessibleDescription(
      "Sur iPhone et iPad, l'installation se fait depuis Safari, en trois gestes.",
    );
    expect(
      within(dialog)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "1Touchez le bouton Partager , un carré avec une flèche vers le haut.",
      "2Choisissez Sur l'écran d'accueil.",
      "3Touchez Ajouter : l'icône KolabReport arrive sur l'écran d'accueil.",
    ]);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("closes the steps with Fermer too", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(IPHONE);
    const user = await renderButton();
    await user.click(installButton()!);
    await user.click(screen.getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
