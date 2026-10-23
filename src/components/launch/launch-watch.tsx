"use client";

import { useEffect } from "react";
import { useNow } from "./use-now";

/**
 * Sets <html data-launched> at the launch second, for a page left open
 * across it. The inline script of launch-script.ts covers a page opened
 * after the launch.
 */
export function LaunchWatch({ until }: { until: string }) {
  const now = useNow();
  const launched = now !== null && now >= Date.parse(until);

  useEffect(() => {
    if (launched) document.documentElement.dataset.launched = "";
  }, [launched]);

  return null;
}
