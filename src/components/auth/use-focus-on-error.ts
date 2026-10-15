"use client";

import { useEffect, useRef } from "react";

/**
 * Puts the focus back in the form after a failed submit. The submit button is
 * disabled while the action runs, so the browser drops the focus to the page
 * and a screen reader user loses their place.
 *
 * The focus goes to the field named `prefer` when it is marked invalid, else to
 * the first invalid field, else to the submit button. A new `state` object
 * means a new answer from the action, so the focus moves again on each failure.
 * The Turnstile widget is a group, not a field: it is marked with
 * data-invalid instead of aria-invalid.
 */
export function useFocusOnError(state: object, failed: boolean, prefer?: string) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = formRef.current;
    if (!failed || !form) return;
    const preferred = prefer
      ? form.querySelector<HTMLElement>(`[name="${prefer}"][aria-invalid="true"]`)
      : null;
    const target =
      preferred ??
      form.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]') ??
      form.querySelector<HTMLElement>('button[type="submit"]');
    target?.focus();
  }, [state, failed, prefer]);

  return formRef;
}

/**
 * Focuses the message that replaces a form once it is sent. The submit button
 * goes away with the form, and the focus would fall back to the page.
 */
export function useFocusWhenShown<T extends HTMLElement>(shown: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (shown) ref.current?.focus();
  }, [shown]);

  return ref;
}
