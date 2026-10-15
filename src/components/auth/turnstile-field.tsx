"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { CAPTCHA_FIELD } from "@/lib/auth/captcha";

// Explicit rendering: the script renders nothing until a form asks for it.
// Cloudflare asks to load it from this exact URL, never from a copy.
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const ERROR_ID = "captcha-error";

/** Shows in Turnstile analytics which form a challenge came from. */
export type TurnstileAction = "sign-up" | "sign-in" | "password-reset" | "account-deletion";

type TurnstileOptions = {
  sitekey: string;
  action?: string;
  theme?: "light" | "dark" | "auto";
  language?: string;
  size?: "normal" | "flexible" | "compact";
  "response-field"?: boolean;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  "error-callback"?: (code: string) => boolean;
};

export type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileOptions): string | null | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/** Adds the Turnstile script to the page once, the first time a form needs it. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = (reason: string) => {
      // The next form tries again, for example once the network is back.
      loading = null;
      script.remove();
      reject(new Error(reason));
    };
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.addEventListener("load", () => {
      if (!window.turnstile) return fail("Turnstile did not start");
      // From now on window.turnstile answers.
      loading = null;
      resolve(window.turnstile);
    });
    script.addEventListener("error", () => fail("The Turnstile script did not load"));
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Cloudflare Turnstile widget for a form. It puts the token in a hidden
 * `captchaToken` field, empties it when the token expires, and starts a new
 * challenge after each failed submit, since a token works only once.
 */
export function TurnstileField({
  siteKey,
  action,
  resetKey,
  error,
}: {
  siteKey: string;
  action: TurnstileAction;
  /** A new value resets the widget. Pass the form state: it changes on every answer. */
  resetKey: unknown;
  /** Translated error from the server action, for a missing or refused token. */
  error?: string;
}) {
  const t = useTranslations("Auth");
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" || resolvedTheme === "dark" ? resolvedTheme : "auto";
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  // A theme change renders a new widget: Turnstile cannot restyle one.
  useEffect(() => {
    let active = true;
    let id: string | null = null;
    loadTurnstile().then(
      (turnstile) => {
        const container = containerRef.current;
        if (!active || !container) return;
        id =
          turnstile.render(container, {
            sitekey: siteKey,
            action,
            theme,
            language: "fr",
            // Flexible needs 300 pixels. Narrow phones get the compact widget.
            size: container.clientWidth >= 300 ? "flexible" : "compact",
            // The hidden field below carries the token.
            "response-field": false,
            callback: (value) => {
              setToken(value);
              setUnavailable(false);
            },
            "expired-callback": () => setToken(""),
            "timeout-callback": () => setToken(""),
            "error-callback": () => {
              setToken("");
              setUnavailable(true);
              // Handled here: Turnstile does not throw it.
              return true;
            },
          }) ?? null;
        widgetId.current = id;
      },
      () => {
        if (active) setUnavailable(true);
      },
    );
    return () => {
      active = false;
      widgetId.current = null;
      setToken("");
      if (id) window.turnstile?.remove(id);
    };
  }, [siteKey, action, theme]);

  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    if (lastResetKey.current === resetKey) return;
    lastResetKey.current = resetKey;
    setToken("");
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, [resetKey]);

  const message = unavailable ? t("errors.captchaUnavailable") : error;

  return (
    <div className="space-y-2">
      {/* Turnstile fills this element with its iframe. React adds nothing to it. */}
      <div
        ref={containerRef}
        role="group"
        aria-label={t("captchaLabel")}
        aria-describedby={message ? ERROR_ID : undefined}
        // useFocusOnError puts the focus here when the server refused the token.
        data-invalid={error ? "true" : undefined}
        tabIndex={-1}
        // Room for the widget before it loads: 65 pixels high, 140 when compact.
        className="min-h-[140px] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring min-[380px]:min-h-[65px]"
      />
      {message ? (
        <p id={ERROR_ID} role={unavailable ? "alert" : undefined} className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
      <input type="hidden" name={CAPTCHA_FIELD} value={token} />
    </div>
  );
}
