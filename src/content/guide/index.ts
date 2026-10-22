import { expertPart } from "./expert";
import { faqPart } from "./faq";
import { ownerPart } from "./owner";
import type { GuideDocument } from "./types";

/** The user guide (KRB-199). Server only: the page renders it as HTML, the browser gets no copy. */
export const GUIDE: GuideDocument = {
  updatedAt: "2026-10-22",
  intro: [
    "Ce guide explique comment utiliser KolabReport pour rédiger un rapport d'expertise en équipe. Chaque partie correspond à un rôle : lisez celle qui vous concerne, puis les questions fréquentes.",
    "Les captures d'écran montrent des données de démonstration : l'organisation, les personnes et les rapports sont inventés.",
  ],
  parts: [ownerPart, expertPart, faqPart],
};
