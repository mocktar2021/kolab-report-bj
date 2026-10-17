"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { SIDEBAR_COLLAPSED as COLLAPSED, SIDEBAR_STORAGE_KEY as STORAGE_KEY } from "./sidebar-script";

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === COLLAPSED;
  } catch {
    return false;
  }
}

function persist(collapsed: boolean) {
  try {
    if (collapsed) {
      window.localStorage.setItem(STORAGE_KEY, COLLAPSED);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage unavailable: the choice lasts until the next reload.
  }
}

function applyToDocument(collapsed: boolean) {
  if (collapsed) {
    document.documentElement.dataset.sidebar = COLLAPSED;
  } else {
    delete document.documentElement.dataset.sidebar;
  }
}

// The choice made since the page loaded, which still counts when storage is
// unavailable. The hooks of this page are told when it changes.
let chosen: boolean | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function current(): boolean {
  return chosen ?? readStored();
}

/** Collapsed state of the desktop sidebar, kept in localStorage. */
export function useSidebarCollapsed() {
  // Open on the server and while hydrating, then the stored choice.
  const collapsed = useSyncExternalStore(subscribe, current, () => false);

  // Also runs after client-side navigation, where the inline script does not.
  useEffect(() => {
    applyToDocument(current());
  }, []);

  const toggle = useCallback(() => {
    const next = !current();
    chosen = next;
    applyToDocument(next);
    persist(next);
    listeners.forEach((listener) => listener());
  }, []);

  return { collapsed, toggle };
}
