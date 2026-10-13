"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SIDEBAR_COLLAPSED as COLLAPSED,
  SIDEBAR_STORAGE_KEY as STORAGE_KEY,
} from "./sidebar-script";

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

/** Collapsed state of the desktop sidebar, kept in localStorage. */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);

  // Also runs after client-side navigation, where the inline script does not.
  useEffect(() => {
    const stored = readStored();
    applyToDocument(stored);
    setCollapsed(stored);
  }, []);

  const toggle = useCallback(() => {
    const next = !collapsed;
    applyToDocument(next);
    persist(next);
    setCollapsed(next);
  }, [collapsed]);

  return { collapsed, toggle };
}
