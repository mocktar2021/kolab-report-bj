import { useEffect } from "react";

// Work a reload would lose: text being edited, files being sent. The browser
// asks before the page is left, and the update banner (KRB-156) reads
// hasUnsavedWork() before it reloads the page.

const holders = new Set<symbol>();

/** True while a part of the page holds work that a reload would lose. */
export function hasUnsavedWork() {
  return holders.size > 0;
}

/** While `active`, the browser asks before the page is left or reloaded. */
export function useUnsavedWork(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const holder = Symbol("unsaved-work");
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    holders.add(holder);
    window.addEventListener("beforeunload", warn);
    return () => {
      holders.delete(holder);
      window.removeEventListener("beforeunload", warn);
    };
  }, [active]);
}
