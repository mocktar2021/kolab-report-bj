import type { LegalBlock, RichText } from "@/content/legal/types";
import type { GuideFigureKey } from "./figures";

/**
 * The user guide (KRB-199) is a typed module like the legal texts (see
 * docs/legal.md): the same rich text ([label](href), **bold**, `code`) and
 * the same blocks, plus numbered steps and screenshots.
 */
export type GuideBlock =
  | LegalBlock
  /** Numbered steps, in the order the user follows them. */
  | { steps: RichText[] }
  /** A screenshot of public/guide (GUIDE_FIGURES), with a short caption under it. */
  | { figure: GuideFigureKey; caption: string };

export type GuideSection = {
  /** Anchor of the section (/fr/guide#importer-le-plan). Never rename one once published. */
  id: string;
  title: string;
  body: GuideBlock[];
};

/** One part per role, then the questions. Each part is numbered in the page and the PDF. */
export type GuidePart = {
  id: string;
  title: string;
  intro: GuideBlock[];
  sections: GuideSection[];
};

export type GuideDocument = {
  /** Date of the last change of the text (YYYY-MM-DD), shown as "Dernière mise à jour". */
  updatedAt: string;
  intro: GuideBlock[];
  parts: GuidePart[];
};
