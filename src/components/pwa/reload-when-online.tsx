"use client";

import { useEffect } from "react";
import { reloadPage } from "@/lib/pwa/reload-page";

/**
 * Reloads the offline page when the network comes back, so the visitor gets
 * the page they asked for. Only this page does it: a reload elsewhere could
 * throw away text being edited (KRB-156).
 */
export function ReloadWhenOnline() {
  useEffect(() => {
    window.addEventListener("online", reloadPage);
    return () => window.removeEventListener("online", reloadPage);
  }, []);
  return null;
}
