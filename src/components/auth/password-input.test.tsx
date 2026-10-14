import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../messages/fr.json";
import { PasswordInput } from "./password-input";

function renderField() {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <label htmlFor="pw">Mot de passe</label>
      <PasswordInput id="pw" name="password" />
    </NextIntlClientProvider>,
  );
  return screen.getByLabelText("Mot de passe", { selector: "input" });
}

describe("PasswordInput", () => {
  it("starts hidden and toggles visibility", async () => {
    const user = userEvent.setup();
    const input = renderField();
    expect(input).toHaveAttribute("type", "password");

    const toggle = screen.getByRole("button", { name: "Afficher le mot de passe" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    // Same name in both states: screen readers announce the pressed state instead.
    expect(toggle).toHaveAccessibleName("Afficher le mot de passe");
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.click(toggle);
    expect(input).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps what was typed when toggling", async () => {
    const user = userEvent.setup();
    const input = renderField();
    await user.type(input, "Kolab-2026");
    await user.click(screen.getByRole("button", { name: "Afficher le mot de passe" }));
    expect(input).toHaveValue("Kolab-2026");
  });
});
