"use client";

import { useEffect } from "react";
import { clearOfflineCaches } from "@/lib/pwa/clear-offline-caches";

/** Removes the pages kept for offline reading, as signing out does. */
export function ClearOfflineCaches() {
  useEffect(() => {
    clearOfflineCaches();
  }, []);
  return null;
}
