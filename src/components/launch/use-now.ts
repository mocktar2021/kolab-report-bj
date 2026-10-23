"use client";

import { useSyncExternalStore } from "react";

function subscribe(onTick: () => void) {
  const id = window.setInterval(onTick, 1000);
  return () => window.clearInterval(id);
}

// Whole seconds, so two reads in the same second give the same value.
const now = () => Math.floor(Date.now() / 1000) * 1000;

/**
 * The browser clock in milliseconds, updated every second. Null during the
 * server render and hydration, so the server markup and the first client
 * render match.
 */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, now, () => null);
}
