// Routes of the legal pages (KRB-159), without the locale prefix. Kept apart
// from the texts: the middleware and the footers import only these paths.
export const LEGAL_PAGES = {
  mentionsLegales: "/mentions-legales",
  confidentialite: "/confidentialite",
  cgu: "/cgu",
  cgv: "/cgv",
  accordTraitement: "/accord-traitement-donnees",
} as const;

export type LegalPageKey = keyof typeof LEGAL_PAGES;

/** Every legal page, in the order the footers list them. */
export const LEGAL_PAGE_KEYS = Object.keys(LEGAL_PAGES) as LegalPageKey[];

/** The pages linked from the sign-in pages and the app: the data processing agreement is for firms. */
export const MAIN_LEGAL_PAGE_KEYS = [
  "mentionsLegales",
  "confidentialite",
  "cgu",
  "cgv",
] as const satisfies readonly LegalPageKey[];
