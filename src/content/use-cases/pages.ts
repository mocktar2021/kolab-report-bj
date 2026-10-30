import type { GuideFigureKey } from "@/content/guide/figures";

// The use-case pages (KRB-262): one public page per kind of report, under
// /fr/solutions. All their text is here so it reads as one document. Every
// claim matches the app and the user guide: change the guide first when a
// feature changes. Shared labels (buttons, headings) are in messages/fr.json
// under UseCases.

/** A section of the example plan. A section with children has no author of its own. */
export type PlanItem = {
  title: string;
  /** Who writes it, by role in the team. */
  who?: string;
  note?: string;
  children?: PlanItem[];
};

export type UseCase = {
  /** Last part of the path: /solutions/<slug>. */
  slug: string;
  /** Link text in the footer and on the landing page. */
  label: string;
  /** One line under the link on the landing page. */
  summary: string;
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  /** The H1. */
  title: string;
  lead: string;
  audience: string[];
  audienceNote: string;
  planTitle: string;
  planIntro: string;
  plan: PlanItem[];
  ai: string[];
  figure: GuideFigureKey;
  figureCaption: string;
};

/** Where the use-case pages live, without the locale prefix. */
export const USE_CASES_PATH = "/solutions";

export const USE_CASES = [
  {
    slug: "rapport-d-audit",
    label: "Rapports d'audit",
    summary: "Une section par auditeur, des constats tirés des pièces collectées.",
    metaTitle: "Rédiger un rapport d'audit en équipe",
    metaDescription:
      "Le chef de mission attribue les sections du rapport d'audit. Chaque auditeur dépose ses pièces, part d'un brouillon de l'IA et valide son texte.",
    eyebrow: "Rapports d'audit",
    title: "Chaque auditeur rédige sa partie, dans le même rapport",
    lead: "Audit organisationnel, de conformité, énergétique ou de projet : le chef de mission découpe le rapport en sections et les attribue. Chaque auditeur dépose ses pièces, part d'un brouillon de l'IA et valide son texte. Le rapport sort en Word ou en PDF, sans copier-coller entre fichiers.",
    audience: [
      "Les cabinets d'audit et de conseil qui livrent un rapport écrit par plusieurs auditeurs.",
      "Les chefs de mission qui rassemblent aujourd'hui les parties de chacun dans un seul fichier Word.",
      "Les services d'audit interne des entreprises, des institutions et des ONG.",
    ],
    audienceNote:
      "KolabReport sert à rédiger le rapport. Il ne remplace pas votre logiciel de dossiers de travail.",
    planTitle: "Un rapport d'audit type",
    planIntro:
      "Importez le plan depuis les termes de référence ou un rapport précédent : chaque titre devient une section. Attribuez ensuite chaque section à un membre de l'équipe.",
    plan: [
      {
        title: "Résumé",
        who: "Chef de mission",
        note: "Rédigé en dernier, quand les constats sont validés.",
      },
      { title: "Contexte, objectifs et périmètre", who: "Chef de mission" },
      {
        title: "Méthodologie",
        who: "Chef de mission",
        note: "Entretiens, revue documentaire, tests réalisés.",
      },
      {
        title: "Constats",
        children: [
          { title: "Gouvernance et organisation", who: "Auditeur 1" },
          { title: "Processus et contrôle interne", who: "Auditeur 2" },
          { title: "Systèmes d'information", who: "Auditeur 3" },
        ],
      },
      {
        title: "Recommandations et plan d'action",
        who: "Chef de mission",
        note: "Le modèle Recommandations les classe par priorité.",
      },
      { title: "Annexes", who: "Chef de mission", note: "Personnes rencontrées, documents consultés." },
    ],
    ai: [
      "Chaque auditeur dépose ses pièces dans sa section : notes d'entretien, extractions Excel ou CSV, procédures et rapports reçus en Word ou en PDF.",
      "L'IA rédige un premier jet des constats à partir de ces fichiers, selon les consignes de la section, et cite le fichier d'où vient chaque constat.",
      "Elle a pour consigne de ne rien inventer : quand une pièce manque, le brouillon le dit. L'auditeur vérifie les chiffres avant d'accepter.",
      "Rien n'entre dans le rapport sans l'auditeur : il accepte le brouillon, le modifie ou le rejette.",
      "Les adresses e-mail, numéros de téléphone, IBAN et numéros de carte sont masqués avant l'envoi à l'IA.",
    ],
    figure: "rapportSections",
    figureCaption: "Le sommaire d'un rapport : chaque section a son expert et son poids dans l'avancement.",
  },
  {
    slug: "rapport-d-evaluation",
    label: "Rapports d'évaluation",
    summary: "Un critère par évaluateur, les données de terrain lues par l'IA.",
    metaTitle: "Rapport d'évaluation de projet en équipe",
    metaDescription:
      "Évaluation à mi-parcours ou finale : un évaluateur par critère, l'IA part des données de terrain, le chef d'équipe livre le rapport en Word ou PDF.",
    eyebrow: "Rapports d'évaluation de projets",
    title: "Un rapport d'évaluation, un critère par évaluateur",
    lead: "Évaluation à mi-parcours, finale ou d'impact : l'équipe se partage les critères, dépose ses données de terrain et part d'un brouillon de l'IA. Le chef d'équipe suit l'avancement de chaque section jusqu'à la remise au commanditaire.",
    audience: [
      "Les consultants et bureaux d'études qui répondent aux appels d'offres d'évaluation des bailleurs, des ministères et des ONG.",
      "Les équipes d'évaluation de deux à dix personnes, souvent dans des villes différentes.",
      "Les services de suivi-évaluation des projets et des programmes.",
    ],
    audienceNote:
      "Invitez le commanditaire comme lecteur : il lit le rapport sans le modifier, et les lecteurs sont gratuits.",
    planTitle: "Un rapport d'évaluation type, selon les critères du CAD de l'OCDE",
    planIntro:
      "Les termes de référence donnent souvent le plan. Importez-les : chaque titre devient une section, et le texte sous le titre devient ses consignes pour l'IA.",
    plan: [
      {
        title: "Résumé exécutif",
        who: "Chef d'équipe",
        note: "Rédigé en dernier, quand les constats sont validés.",
      },
      { title: "Contexte du projet et objet de l'évaluation", who: "Chef d'équipe" },
      {
        title: "Méthodologie et limites",
        who: "Chef d'équipe",
        note: "Échantillon, outils de collecte, limites de l'évaluation.",
      },
      {
        title: "Constats par critère",
        children: [
          { title: "Pertinence et cohérence", who: "Évaluateur 1" },
          { title: "Efficacité", who: "Évaluateur 2" },
          { title: "Efficience", who: "Évaluateur 3" },
          { title: "Impact et durabilité", who: "Évaluateur 1" },
        ],
      },
      { title: "Conclusions et leçons apprises", who: "Chef d'équipe" },
      {
        title: "Recommandations",
        who: "Chef d'équipe",
        note: "Le modèle Recommandations les classe par priorité.",
      },
      {
        title: "Annexes",
        who: "Chef d'équipe",
        note: "Termes de référence, outils de collecte, personnes rencontrées.",
      },
    ],
    ai: [
      "Les évaluateurs déposent les bases d'enquête en Excel ou CSV, les comptes rendus d'entretiens et de groupes de discussion, et les rapports du projet.",
      "Avec le modèle Analyse de données, l'IA décrit ce que montrent les tableaux : chiffres, écarts et limites.",
      "Chaque constat cite le fichier d'où il vient, pour que le chef d'équipe remonte à la source.",
      "L'IA lit les tableaux, elle ne fait pas vos calculs statistiques : déposez les tableaux déjà produits par votre logiciel.",
      "L'évaluateur relit, corrige puis accepte. Rien n'entre dans le rapport sans lui.",
    ],
    figure: "brouillonIa",
    figureCaption:
      "Un brouillon de l'IA : l'évaluateur l'accepte, le modifie avant d'accepter ou le rejette.",
  },
  {
    slug: "rapport-d-etude",
    label: "Rapports d'études",
    summary: "Une section par spécialiste, du diagnostic aux recommandations.",
    metaTitle: "Rédiger un rapport d'étude en équipe",
    metaDescription:
      "Étude de faisabilité, d'impact ou diagnostic : chaque spécialiste rédige sa partie, l'IA part de ses données, le rapport sort en Word ou PDF.",
    eyebrow: "Rapports d'études",
    title: "Un rapport d'étude, une section par spécialiste",
    lead: "Étude de faisabilité, étude d'impact environnemental et social, diagnostic ou étude de marché : l'ingénieur, l'économiste et l'environnementaliste rédigent chacun leur partie dans le même rapport. Le chef de projet voit où en est chaque section avant la date de remise.",
    audience: [
      "Les bureaux d'études techniques, environnementaux et socio-économiques.",
      "Les équipes pluridisciplinaires où chaque expert écrit dans son domaine.",
      "Les chefs de projet qui doivent tenir une date de remise avec des experts sur le terrain.",
    ],
    audienceNote:
      "KolabReport s'installe comme une application sur ordinateur et sur téléphone. Les pages déjà ouvertes restent lisibles sans connexion.",
    planTitle: "Une étude de faisabilité type",
    planIntro:
      "Créez les sections à la main ou importez le plan de l'offre technique. Chaque spécialiste reçoit sa section et ne modifie que la sienne.",
    plan: [
      {
        title: "Résumé",
        who: "Chef de projet",
        note: "Rédigé en dernier, quand les analyses sont validées.",
      },
      { title: "Contexte et objectifs de l'étude", who: "Chef de projet" },
      { title: "Diagnostic de la situation actuelle", who: "Chef de projet" },
      {
        title: "Analyses",
        children: [
          { title: "Étude technique", who: "Ingénieur" },
          { title: "Étude économique et financière", who: "Économiste" },
          { title: "Analyse environnementale et sociale", who: "Environnementaliste" },
        ],
      },
      {
        title: "Variantes et recommandations",
        who: "Chef de projet",
        note: "Le modèle Recommandations les classe par priorité.",
      },
      { title: "Annexes", who: "Chef de projet", note: "Plans, devis, résultats de mesures." },
    ],
    ai: [
      "Chaque spécialiste dépose ses notes de terrain, ses relevés et ses calculs : Word, Excel, CSV, texte ou PDF.",
      "L'IA rédige un premier jet de sa section en suivant les consignes, et cite les fichiers utilisés.",
      "Elle ne lit ni les photos, ni les plans, ni les PDF scannés. Décrivez dans vos notes ce qu'ils montrent si la section en a besoin.",
      "Les photos et schémas collés dans le texte apparaissent dans les exports Word et PDF, avec leur légende.",
      "Le spécialiste accepte, modifie ou rejette le brouillon. Il garde la main sur son texte.",
    ],
    figure: "livrables",
    figureCaption: "Les livrables d'une section : l'IA lit les fichiers Excel et Word, pas la photo.",
  },
] as const satisfies readonly UseCase[];

export type UseCaseSlug = (typeof USE_CASES)[number]["slug"];

/** Path of a use-case page, without the locale prefix. */
export function solutionPath(slug: UseCaseSlug): string {
  return `${USE_CASES_PATH}/${slug}`;
}

export type UseCaseEntry = (typeof USE_CASES)[number];

export function findUseCase(slug: string): UseCaseEntry | undefined {
  return USE_CASES.find((useCase) => useCase.slug === slug);
}
