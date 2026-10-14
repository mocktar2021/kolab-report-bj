// Facts about the publisher and seller of KolabReport, shared by every legal
// page. Change them here only. Source: the KRB-159 brief and the group's
// entities page.

export const PUBLISHER = {
  name: "Mocktar Technologies",
  legalForm: "Établissement",
  address: "C 1357 Houeyiho, 07BP91 Cotonou, République du Bénin",
  rccm: "COTONOU N° RB/COT/26 A 119654",
  ifu: "1200900488800",
  cnss: "12009004888001",
  email: "support@mocktar.com",
  director: "Mocktar Adjibade Tairou",
  website: "https://mocktar.com",
  entitiesPage: "https://mocktar.com/fr/legal/entities",
} as const;

/** Sister company in the United States. It supports engineering and is not the seller for FCFA customers. */
export const GROUP_COMPANY = {
  name: "Mocktar Technologies LLC",
  address: "4736 Black Forest Dr, Greensboro, NC 27405, États-Unis",
} as const;

/** The support address as a rich text link. */
export const SUPPORT_EMAIL = `[${PUBLISHER.email}](mailto:${PUBLISHER.email})`;
