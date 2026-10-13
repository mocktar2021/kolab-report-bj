import { z } from "zod";
import { escapeInline, tableToMarkdown } from "@/lib/deliverables/parse/markdown";
import { PARSE_LIMITS } from "@/lib/deliverables/parse/types";

// Builds the bulk of the long cases at load time, so the repository doesn't
// store megabytes of filler. The output is the same on every run for a given
// seed (no Math.random, no dates from the clock), and looks like what the
// parsers produce: "##" headings and paragraphs for a Word file, "## Sheet"
// and GitHub tables for a workbook.

const TOPICS = ["forages", "mutuelle"] as const;

export type GeneratorTopic = (typeof TOPICS)[number];

export const generatedSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("narrative"),
      topic: z.enum(TOPICS),
      seed: z.number().int(),
      /** Filler chapters appended after the hand-written Markdown. */
      sections: z.number().int().min(1).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal("table"),
      topic: z.enum(TOPICS),
      seed: z.number().int(),
      sheets: z
        .array(
          z
            .object({
              name: z.string().min(1).max(31),
              rows: z.number().int().min(1).max(PARSE_LIMITS.maxRowsPerSheet),
            })
            .strict(),
        )
        .min(1)
        .max(PARSE_LIMITS.maxSheets),
    })
    .strict(),
]);

export type GeneratedContent = z.infer<typeof generatedSchema>;

/** Small seeded generator (mulberry32): same seed, same sequence. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;

function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error("pick from an empty list");
  return item;
}

function between(random: Random, min: number, max: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round((min + random() * (max - min)) * factor) / factor;
}

type Vocabulary = {
  places: readonly string[];
  chapters: readonly string[];
  subjects: readonly string[];
  verbs: readonly string[];
  objects: readonly string[];
  details: readonly string[];
  actions: readonly string[];
};

const VOCABULARY: Record<GeneratorTopic, Vocabulary> = {
  forages: {
    places: ["Bembèrèkè", "Kalalé", "Nikki", "Sinendé", "N'Dali", "Tchaourou", "Pèrèrè", "Parakou"],
    chapters: [
      "Visite de terrain",
      "Relevés de la campagne",
      "Entretien avec le comité de gestion",
      "État des superstructures",
      "Qualité de l'eau",
      "Organisation de la maintenance",
    ],
    subjects: [
      "Le comité de gestion du point d'eau",
      "L'artisan réparateur du secteur",
      "L'équipe de suivi",
      "Le fontainier",
      "Le chef de village",
      "Le technicien de la mairie",
    ],
    verbs: ["signale", "indique", "confirme", "rappelle", "note", "rapporte"],
    objects: [
      "une baisse du débit en fin de saison sèche",
      "des fuites au niveau de la tête de pompe",
      "une file d'attente plus longue le matin",
      "un dallage fissuré autour de la margelle",
      "un cahier de recettes tenu à jour",
      "des pièces de rechange achetées à Parakou",
      "une eau un peu trouble après les premières pluies",
      "un abreuvoir trop proche du forage",
    ],
    details: [
      "La visite a eu lieu en présence de deux membres du comité.",
      "Les usagers rencontrés viennent surtout des hameaux voisins.",
      "Le carnet de maintenance n'a pas été présenté le jour de la visite.",
      "La redevance est collectée chaque semaine par la trésorière.",
      "Aucune analyse d'eau récente n'a été retrouvée sur place.",
      "Le périmètre de protection n'est pas clôturé.",
    ],
    actions: [
      "reprendre le dallage",
      "remplacer les joints de la pompe",
      "former un deuxième fontainier",
      "afficher les horaires d'ouverture",
      "clôturer le périmètre de protection",
      "prévoir une analyse d'eau avant la saison des pluies",
    ],
  },
  mutuelle: {
    // The five antennes of the long-mutuelle-zou case.
    places: ["Abomey", "Bohicon", "Covè", "Djidja", "Zogbodomey"],
    chapters: [
      "Vie de l'antenne",
      "Adhésions et cotisations",
      "Prestations servies",
      "Relations avec les centres de santé",
      "Gestion administrative",
      "Sensibilisation des membres",
    ],
    subjects: [
      "Le gérant de l'antenne",
      "Le comité de contrôle",
      "Le médecin conseil",
      "L'animatrice de terrain",
      "Le trésorier",
      "Le responsable du centre de santé partenaire",
    ],
    verbs: ["signale", "indique", "confirme", "rappelle", "note", "rapporte"],
    objects: [
      "des retards de paiement des cotisations après la récolte",
      "une hausse des consultations pour paludisme",
      "des feuilles de soins incomplètes",
      "des délais de remboursement trop longs",
      "une bonne participation aux assemblées de village",
      "des cartes d'adhérent non renouvelées",
      "un registre des adhérents à mettre à jour",
      "des demandes d'adhésion de groupements de femmes",
    ],
    details: [
      "La réunion s'est tenue au siège de l'antenne.",
      "Les chiffres cités proviennent du registre tenu à la main.",
      "Le logiciel de gestion n'est pas encore installé dans cette antenne.",
      "Les membres rencontrés sont surtout des producteurs de maïs.",
      "Le centre de santé partenaire n'a pas transmis ses factures du mois.",
      "Le local de l'antenne est partagé avec une coopérative.",
    ],
    actions: [
      "relancer les adhérents en retard",
      "former les agents à la saisie des feuilles de soins",
      "afficher le barème des prestations",
      "organiser une assemblée après la récolte",
      "rapprocher le registre et les reçus",
      "signer un avenant avec le centre de santé",
    ],
  },
};

const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

function sentence(random: Random, words: Vocabulary): string {
  const shape = Math.floor(random() * 4);
  const place = pick(random, words.places);
  switch (shape) {
    case 0:
      return `${pick(random, words.subjects)} de ${place} ${pick(random, words.verbs)} ${pick(random, words.objects)}.`;
    case 1:
      return `À ${place}, l'équipe relève ${pick(random, words.objects)}.`;
    case 2:
      return pick(random, words.details);
    default:
      return `Il est proposé de ${pick(random, words.actions)} à ${place} d'ici ${pick(random, MONTHS)}.`;
  }
}

function paragraph(random: Random, words: Vocabulary): string {
  const count = 3 + Math.floor(random() * 3);
  return Array.from({ length: count }, () => sentence(random, words)).join(" ");
}

function narrative(content: Extract<GeneratedContent, { type: "narrative" }>): string {
  const random = seededRandom(content.seed);
  const words = VOCABULARY[content.topic];
  const parts: string[] = [];
  for (let index = 1; index <= content.sections; index++) {
    const place = pick(random, words.places);
    parts.push(`## Annexe ${index} : ${pick(random, words.chapters)} à ${place}`);
    const paragraphs = 2 + Math.floor(random() * 3);
    for (let count = 0; count < paragraphs; count++) parts.push(paragraph(random, words));
    if (random() < 0.4) {
      parts.push(
        Array.from(
          { length: 3 },
          () => `- ${pick(random, words.actions).replace(/^./, (c) => c.toUpperCase())}`,
        )
          .filter((item, position, items) => items.indexOf(item) === position)
          .join("\n"),
      );
    }
  }
  return parts.join("\n\n");
}

type Row = string[];

function forageRows(random: Random, sheet: number, count: number): Row[] {
  const places = VOCABULARY.forages.places;
  const header = ["Date", "Commune", "Forage", "Débit (m³/h)", "Niveau statique (m)", "Conductivité (µS/cm)"];
  const rows: Row[] = [header];
  for (let index = 0; index < count - 1; index++) {
    const day = 1 + (index % 28);
    const month = 1 + ((sheet + Math.floor(index / 28)) % 12);
    rows.push([
      `2025-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      pick(random, places),
      `F-${String(100 + Math.floor(random() * 214)).padStart(3, "0")}`,
      String(between(random, 0.4, 3.8, 1)),
      String(between(random, 6, 42, 1)),
      String(Math.round(between(random, 180, 920))),
    ]);
  }
  return rows;
}

function mutuelleRows(random: Random, sheet: number, count: number): Row[] {
  const places = VOCABULARY.mutuelle.places;
  const header = [
    "Mois",
    "Antenne",
    "Adhérents à jour",
    "Cotisations encaissées (FCFA)",
    "Prestations payées (FCFA)",
    "Feuilles de soins reçues",
  ];
  const rows: Row[] = [header];
  for (let index = 0; index < count - 1; index++) {
    const month = 1 + ((sheet * 3 + index) % 12);
    const year = 2024 + Math.floor((sheet * 3 + index) / 12);
    rows.push([
      `${year}-${String(month).padStart(2, "0")}`,
      pick(random, places),
      String(Math.round(between(random, 120, 980))),
      String(Math.round(between(random, 150, 1900)) * 500),
      String(Math.round(between(random, 100, 1700)) * 500),
      String(Math.round(between(random, 20, 400))),
    ]);
  }
  return rows;
}

function workbook(content: Extract<GeneratedContent, { type: "table" }>): string {
  const random = seededRandom(content.seed);
  const parts: string[] = [];
  content.sheets.forEach((sheet, index) => {
    const rows =
      content.topic === "forages"
        ? forageRows(random, index, sheet.rows)
        : mutuelleRows(random, index, sheet.rows);
    parts.push(`## ${escapeInline(sheet.name)}`, tableToMarkdown(rows.map((row) => row.map(escapeInline))));
  });
  return parts.join("\n\n");
}

/** The generated Markdown for one deliverable. */
export function generateContent(content: GeneratedContent): string {
  return content.type === "narrative" ? narrative(content) : workbook(content);
}
