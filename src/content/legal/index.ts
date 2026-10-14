import { accordTraitement } from "./accord-traitement-donnees";
import { cgu } from "./cgu";
import { cgv } from "./cgv";
import { confidentialite } from "./confidentialite";
import { mentionsLegales } from "./mentions-legales";
import type { LegalPageKey } from "./pages";
import type { LegalDocument } from "./types";

/** The text of each legal page. Server only: the pages render it as HTML, the browser gets no copy. */
export const LEGAL_DOCUMENTS: Record<LegalPageKey, LegalDocument> = {
  mentionsLegales,
  confidentialite,
  cgu,
  cgv,
  accordTraitement,
};
