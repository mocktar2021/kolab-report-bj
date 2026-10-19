"use client";

import { useLayoutEffect, useRef, useState, type ComponentType } from "react";

/** What a menu loaded by useLazyMenu gets from the button it replaces. */
export type LazyMenuProps = {
  /** The button was used before the menu loaded: it starts open. */
  defaultOpen: boolean;
  /** The button had the focus: the menu's own button takes it. */
  autoFocus: boolean;
};

const OPEN_KEYS = new Set(["Enter", " ", "ArrowDown"]);

/**
 * A menu whose code, Radix included, loads when its button is pointed at or
 * focused, not with the page (KRB-212). Until then the page shows a plain
 * button with the same look: spread placeholderProps on it. Using it opens the
 * menu once loaded, as Radix would have: pointer down, Enter, Space or Arrow
 * Down.
 */
export function useLazyMenu<P extends LazyMenuProps>(load: () => Promise<ComponentType<P>>) {
  const placeholder = useRef<HTMLButtonElement>(null);
  const loading = useRef(false);
  const [Menu, setMenu] = useState<ComponentType<P> | null>(null);
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [autoFocus, setAutoFocus] = useState(false);

  function start(open: boolean) {
    if (open) setDefaultOpen(true);
    if (loading.current) return;
    loading.current = true;
    load().then(
      (component) => {
        setAutoFocus(document.activeElement === placeholder.current);
        setMenu(() => component);
      },
      // Offline with the chunk not cached: the next use tries again.
      () => (loading.current = false),
    );
  }

  return {
    Menu,
    menuProps: { defaultOpen, autoFocus } satisfies LazyMenuProps,
    placeholderProps: {
      ref: placeholder,
      "aria-haspopup": "menu" as const,
      "aria-expanded": false,
      onPointerEnter: () => start(false),
      onFocus: () => start(false),
      onPointerDown: (event: React.PointerEvent) => {
        if (event.button !== 0 || event.ctrlKey) return;
        event.preventDefault();
        start(true);
      },
      // A click without pointer down, such as one from a screen reader.
      onClick: () => start(true),
      onKeyDown: (event: React.KeyboardEvent) => {
        if (!OPEN_KEYS.has(event.key)) return;
        event.preventDefault();
        start(true);
      },
    },
  };
}

/**
 * For the menu's button: takes the focus the placeholder had. An open menu
 * takes it itself, and Radix gives it back to the button on close.
 */
export function useLazyMenuFocus({ defaultOpen, autoFocus }: LazyMenuProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [focusOnMount] = useState(autoFocus && !defaultOpen);
  useLayoutEffect(() => {
    if (focusOnMount) button.current?.focus();
  }, [focusOnMount]);
  return button;
}
