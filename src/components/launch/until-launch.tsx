"use client";

import { useNow } from "./use-now";

/**
 * Shows `before` until the launch, then `children`, without a reload. The
 * server render shows `before`: the page only passes a launch time while the
 * launch is ahead.
 */
export function UntilLaunch({
  until,
  before,
  children,
}: {
  until: string;
  before: React.ReactNode;
  children: React.ReactNode;
}) {
  const now = useNow();
  return now !== null && now >= Date.parse(until) ? children : before;
}
