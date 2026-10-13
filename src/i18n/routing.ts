import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // French is the only supported locale for the MVP. Adding a locale later
  // only requires extending this list and adding messages/<locale>.json.
  locales: ["fr"],
  defaultLocale: "fr",
  // Every URL is prefixed: /fr/connexion, /fr/tableau-de-bord, ...
  localePrefix: "always",
  // Ignore the browser's Accept-Language header: the UI is always French.
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
