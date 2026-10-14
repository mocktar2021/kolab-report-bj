import { act, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/fr.json";
import { TURNSTILE_SCRIPT_URL, TurnstileField, type TurnstileApi } from "./turnstile-field";

const theme = vi.hoisted(() => ({ resolved: "dark" as string | undefined }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: theme.resolved }) }));

type Options = Parameters<TurnstileApi["render"]>[1];

/** Stands in for the Cloudflare script: records the widgets and their options. */
function fakeTurnstile() {
  const widgets: Options[] = [];
  const api = {
    render: vi.fn((_container: HTMLElement, options: Options) => {
      widgets.push(options);
      return `widget-${widgets.length}`;
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  return { api, last: () => widgets.at(-1)! };
}

function field(props: { resetKey?: unknown; error?: string } = {}) {
  return (
    <NextIntlClientProvider locale="fr" messages={messages}>
      <TurnstileField
        siteKey="site-key"
        action="sign-up"
        resetKey={props.resetKey ?? "first"}
        error={props.error}
      />
    </NextIntlClientProvider>
  );
}

const scripts = () => document.head.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_URL}"]`);
const token = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[type="hidden"][name="captchaToken"]')!.value;

beforeEach(() => {
  theme.resolved = "dark";
});

afterEach(() => {
  delete window.turnstile;
  scripts().forEach((script) => script.remove());
});

describe("TurnstileField", () => {
  it("loads the script once and renders a French widget in the app theme", async () => {
    const turnstile = fakeTurnstile();
    render(field());
    render(field());
    expect(scripts()).toHaveLength(1);
    expect(turnstile.api.render).not.toHaveBeenCalled();

    window.turnstile = turnstile.api;
    act(() => {
      scripts()[0]!.dispatchEvent(new Event("load"));
    });

    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(2));
    expect(turnstile.last()).toMatchObject({
      sitekey: "site-key",
      action: "sign-up",
      language: "fr",
      theme: "dark",
      "response-field": false,
      // jsdom lays nothing out, so the container is 0 pixels wide.
      size: "compact",
    });
    expect(screen.getAllByRole("group", { name: "Vérification anti-robot" })).toHaveLength(2);
  });

  it("puts the token in the hidden field and empties it when it expires", async () => {
    const turnstile = fakeTurnstile();
    window.turnstile = turnstile.api;
    const { container } = render(field());
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
    expect(token(container)).toBe("");

    act(() => turnstile.last().callback!("token-1"));
    expect(token(container)).toBe("token-1");

    act(() => turnstile.last()["expired-callback"]!());
    expect(token(container)).toBe("");
  });

  it("starts a new challenge after each answer of the server", async () => {
    const turnstile = fakeTurnstile();
    window.turnstile = turnstile.api;
    const { container, rerender } = render(field({ resetKey: "first" }));
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
    act(() => turnstile.last().callback!("token-1"));

    rerender(field({ resetKey: "first" }));
    expect(turnstile.api.reset).not.toHaveBeenCalled();

    rerender(field({ resetKey: "second" }));
    expect(turnstile.api.reset).toHaveBeenCalledWith("widget-1");
    expect(token(container)).toBe("");
  });

  it("ties the server error to the widget and marks it for the focus", async () => {
    window.turnstile = fakeTurnstile().api;
    render(field({ error: "Confirmez que vous n'êtes pas un robot." }));
    const group = screen.getByRole("group", { name: "Vérification anti-robot" });
    expect(group).toHaveAccessibleDescription("Confirmez que vous n'êtes pas un robot.");
    expect(group).toHaveAttribute("data-invalid", "true");
  });

  it("announces a widget error, until a new token comes", async () => {
    const turnstile = fakeTurnstile();
    window.turnstile = turnstile.api;
    render(field());
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());

    let handled: boolean | undefined;
    act(() => {
      handled = turnstile.last()["error-callback"]!("300010");
    });
    expect(handled).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("La vérification anti-robot n'a pas abouti.");

    act(() => turnstile.last().callback!("token-2"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces a script that does not load, and lets the next form try again", async () => {
    render(field());
    act(() => {
      scripts()[0]!.dispatchEvent(new Event("error"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vérifiez votre connexion ou rechargez la page.",
    );
    expect(scripts()).toHaveLength(0);

    render(field());
    expect(scripts()).toHaveLength(1);
  });

  it("renders a new widget when the theme changes, and removes it with the form", async () => {
    const turnstile = fakeTurnstile();
    window.turnstile = turnstile.api;
    const { rerender, unmount } = render(field());
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(1));

    theme.resolved = "light";
    rerender(field());
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(2));
    expect(turnstile.api.remove).toHaveBeenCalledWith("widget-1");
    expect(turnstile.last().theme).toBe("light");

    unmount();
    expect(turnstile.api.remove).toHaveBeenCalledWith("widget-2");
  });
});
