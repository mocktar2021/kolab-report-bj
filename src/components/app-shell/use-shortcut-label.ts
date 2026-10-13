"use client";

import { useSyncExternalStore } from "react";

type NavigatorWithUAData = Navigator & { userAgentData?: { platform?: string } };

function isApplePlatform() {
  const nav = window.navigator as NavigatorWithUAData;
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const subscribe = () => () => {};

/**
 * Modifier key label for the command palette shortcut: ⌘ on Apple devices,
 * Ctrl elsewhere. The server render shows ⌘.
 */
export function useShortcutModifier() {
  return useSyncExternalStore(
    subscribe,
    () => (isApplePlatform() ? "⌘" : "Ctrl"),
    () => "⌘",
  );
}
