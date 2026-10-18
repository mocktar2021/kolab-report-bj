import type { SectionStatus } from "@/lib/sections";

// French text written into the exported files. The builders run without
// next-intl, so the labels the app also shows are copied from
// messages/fr.json, and labels.test.ts fails when the two drift apart.

/** Copy of SectionStatus in messages/fr.json. */
export const STATUS_LABELS: Record<SectionStatus, string> = {
  not_started: "Non commencée",
  in_progress: "En cours",
  completed: "Terminée",
};

/** Copy of Report.unassigned in messages/fr.json. */
export const UNASSIGNED_LABEL = "Non attribuée";

export const EXPORT_TIME_ZONE = "Africa/Porto-Novo";

export const EXPORT_TEXT = {
  contents: "Sommaire",
  emptySection: "Section non rédigée.",
  noSections: "Ce rapport ne contient aucune section.",
} as const;

/**
 * What an image of a section's text (KRB-216) shows in place of itself:
 * its caption, then why. unavailable is a copy of SectionImages.unavailable
 * in messages/fr.json.
 */
export const IMAGE_NOTES = {
  unavailable: "(image indisponible)",
  tooLarge: "(image trop lourde pour l'export)",
  limit: "(image non reprise : l'export a atteint sa limite d'images)",
} as const;

export function imageNote(caption: string, reason: keyof typeof IMAGE_NOTES): string {
  return caption ? `${caption} ${IMAGE_NOTES[reason]}` : IMAGE_NOTES[reason];
}

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: EXPORT_TIME_ZONE });

/** "14 octobre 2026", in Porto-Novo time. */
export function formatExportDate(date: Date): string {
  return DATE_FORMAT.format(date);
}

export function generatedOn(date: Date): string {
  return `Généré le ${formatExportDate(date)}`;
}

/** "Responsable : Awa Diallo · Statut : En cours". */
export function sectionMeta(assigneeName: string | null, status: SectionStatus): string {
  return `Responsable : ${assigneeName?.trim() || UNASSIGNED_LABEL} · Statut : ${STATUS_LABELS[status]}`;
}

/** The words around the numbers of "Page 3 sur 12". The .docx puts Word page fields between them. */
export const PAGE_WORDS = { page: "Page ", of: " sur " } as const;

export function pageLabel(page: number, total: number): string {
  return `${PAGE_WORDS.page}${page}${PAGE_WORDS.of}${total}`;
}
