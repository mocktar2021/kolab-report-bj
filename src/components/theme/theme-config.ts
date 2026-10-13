// Shared by the server layout and the client theme components. Keep this
// module free of "use client".

export const THEME_CHOICES = ["light", "dark", "system"] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** Theme used until the visitor picks one. "system" follows the device setting. */
export const DEFAULT_THEME: ThemeChoice = "system";

/** localStorage key, next to kolabreport:sidebar. */
export const THEME_STORAGE_KEY = "kolabreport:theme";

/** Browser UI color (address bar, PWA title bar) for each resolved theme. */
export const THEME_COLORS = {
  light: "#FAFAFA",
  dark: "#09090B",
} as const;

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && (THEME_CHOICES as readonly string[]).includes(value);
}
