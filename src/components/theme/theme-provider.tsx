"use client";

import { useEffect } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { DEFAULT_THEME, THEME_COLORS, THEME_STORAGE_KEY } from "./theme-config";

/**
 * next-themes writes the theme class on <html> from an inline script before
 * first paint, so a stored choice never flashes the other theme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      themes={["light", "dark"]}
      defaultTheme={DEFAULT_THEME}
      enableSystem
      storageKey={THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      <ThemeColorSync />
      {children}
    </NextThemesProvider>
  );
}

/**
 * The theme-color meta tags follow the device setting by default. When the
 * visitor picks a theme by hand, the browser bar follows that choice instead.
 */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", THEME_COLORS[resolvedTheme]);
    });
  }, [resolvedTheme]);

  return null;
}
