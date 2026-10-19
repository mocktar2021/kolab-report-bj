"use client";

import { useLayoutEffect, useRef, useState, type ComponentType } from "react";

/** What a menu loaded by useLazyMenu gets from the button it replaces. */
export type LazyMenuProps = {
  /** The button was used before the menu loaded, and how: the menu starts open. */
  openedWith: "pointer" | "keyboard" | null;
  /** The button had the focus: the menu's own button takes it. */
  autoFocus: boolean;
};

const OPEN_KEYS = new Set(["Enter", " ", "ArrowDown"]);
const ITEM = '[role^="menuitem"]:not([data-disabled])';

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
  const [openedWith, setOpenedWith] = useState<LazyMenuProps["openedWith"]>(null);
  const [autoFocus, setAutoFocus] = useState(false);

  // The first use counts: the click that follows a pointer down stays a pointer.
  function start(open: LazyMenuProps["openedWith"]) {
    if (open) setOpenedWith((current) => current ?? open);
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
    menuProps: { openedWith, autoFocus } satisfies LazyMenuProps,
    placeholderProps: {
      ref: placeholder,
      "aria-haspopup": "menu" as const,
      "aria-expanded": false,
      onPointerEnter: () => start(null),
      onFocus: () => start(null),
      onPointerDown: (event: React.PointerEvent) => {
        if (event.button !== 0 || event.ctrlKey) return;
        event.preventDefault();
        start("pointer");
      },
      // A click without pointer down, such as one from a screen reader, opens
      // the menu on its first item, like a key.
      onClick: () => start("keyboard"),
      onKeyDown: (event: React.KeyboardEvent) => {
        if (!OPEN_KEYS.has(event.key)) return;
        event.preventDefault();
        start("keyboard");
      },
    },
  };
}

/**
 * For the menu's button and content. The button takes the focus the
 * placeholder had. Opened from the keyboard, the menu starts on its first
 * item, as Radix does when it saw the key: here it loaded after it.
 */
export function useLazyMenuFocus({ openedWith, autoFocus }: LazyMenuProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [focusOnMount] = useState(autoFocus && openedWith === null);
  const firstItemNext = useRef(openedWith === "keyboard");
  useLayoutEffect(() => {
    if (focusOnMount) button.current?.focus();
  }, [focusOnMount]);

  // Radix focuses the content when it opens; only the first opening moves on.
  function onContentFocus(event: React.FocusEvent<HTMLElement>) {
    if (!firstItemNext.current || event.target !== event.currentTarget) return;
    firstItemNext.current = false;
    event.currentTarget.querySelector<HTMLElement>(ITEM)?.focus({ preventScroll: true });
  }

  return { button, onContentFocus };
}
