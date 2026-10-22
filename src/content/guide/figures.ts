import { GUIDE_ASSETS_DIR } from "./pages";

// Screenshots of the user guide (KRB-199), taken on demo data by
// tests/guide/screenshots.spec.ts and stored in public/guide/. The spec reads
// this list to know which screens to capture and where to write them, so a
// new figure starts here. Every alt text describes the screen in French.

export type GuideFigure = {
  /** File name in public/guide/. */
  file: string;
  /** What the screenshot shows, read by screen readers instead of the image. */
  alt: string;
  width: number;
  height: number;
};

/** Size of every capture: the browser window of the screenshot spec. */
export const FIGURE_SIZE = { width: 1280, height: 800 } as const;

/** A screenshot weighs this much at most (WebP), so the page stays light on a mobile network. */
export const FIGURE_MAX_BYTES = 150 * 1024;

function figure(file: string, alt: string): GuideFigure {
  return { file, alt, ...FIGURE_SIZE };
}

export const GUIDE_FIGURES = {
  nouvelEspace: figure(
    "nouvel-espace.webp",
    "Assistant « Créer un espace de travail », étape 1 sur 3 : la liste des organisations que vous gérez et l'option « Nouvelle organisation ».",
  ),
  membres: figure(
    "membres.webp",
    "Page des membres d'un espace de travail : la liste des membres avec leur rôle, le formulaire « Inviter un membre » avec le message « Invitation envoyée », et l'invitation dans « Invitations en attente » avec les boutons Renvoyer et Annuler.",
  ),
  nouveauRapport: figure(
    "nouveau-rapport.webp",
    "Fenêtre « Nouveau rapport » ouverte sur le tableau de bord, avec le titre du rapport saisi et le bouton « Créer le rapport ».",
  ),
  importerLePlan: figure(
    "importer-le-plan.webp",
    "Page « Importer le plan » après la lecture d'un plan collé : la liste « Vérifiez le plan » montre les sections et les sous-sections numérotées.",
  ),
  rapportSections: figure(
    "rapport-sections.webp",
    "Sommaire d'un rapport : sections et sous-sections numérotées, avec pour chacune l'expert attribué, le poids et le bouton Enregistrer.",
  ),
  tableauDeBord: figure(
    "tableau-de-bord.webp",
    "Tableau de bord d'une propriétaire : le nombre de sections non commencées, en cours et terminées, l'avancement global, puis les rapports de l'espace avec leur avancement et le bouton « Nouveau rapport ».",
  ),
  menuDuCompte: figure(
    "menu-du-compte.webp",
    "Menu du compte ouvert en haut à droite du tableau de bord : le nom et l'adresse e-mail, Mon compte, Guide d'utilisation, Thème, Réduire le menu, Se déconnecter, puis les pages d'informations légales.",
  ),
  nouveauModele: figure(
    "nouveau-modele.webp",
    "Page « Nouveau modèle » : le cadre « Décrire ce que vous attendez » avec le bouton « Décrire le modèle », puis la liste « Copier un modèle KolabReport » avec un bouton Copier par modèle.",
  ),
  decrireModele: figure(
    "decrire-modele.webp",
    "Page « Décrire le modèle » en mode « Décrire en quelques phrases », avec une description saisie et le bouton « Rédiger avec l'IA ».",
  ),
  reglagesAvances: figure(
    "reglages-avances.webp",
    "Éditeur d'un modèle avec la partie « Réglages avancés » ouverte : modèle d'IA, liberté de formulation et longueur maximale du texte.",
  ),
  rapportRevue: figure(
    "rapport-revue.webp",
    "En-tête d'un rapport en brouillon : les boutons « Exporter en .docx » et « Exporter en PDF », et le cadre « Revue et finalisation » avec le bouton « Soumettre pour revue ».",
  ),
  abonnement: figure(
    "abonnement.webp",
    "Page « Abonnement » d'une organisation : l'offre en cours et son utilisation, avec les membres, les rapports actifs et les brouillons IA du mois.",
  ),
  section: figure(
    "section.webp",
    "Page d'une section attribuée à l'experte : le menu « Statut de la section » sur En cours, les consignes pour l'IA, puis le texte de la section, ouvert avec « Aperçu », et le bouton « Modifier le texte ».",
  ),
  livrables: figure(
    "livrables.webp",
    "Zone « Déposer des livrables » d'une section avec le bouton « Choisir des fichiers », puis la liste des livrables : une photo marquée « Non analysé », un fichier Excel et un fichier Word marqués « Analysé ».",
  ),
  brouillonIa: figure(
    "brouillon-ia.webp",
    "Brouillon proposé par l'IA pour une section, avec les boutons Accepter, Modifier avant d'accepter et Rejeter.",
  ),
  editeurTexte: figure(
    "editeur-texte.webp",
    "Éditeur d'une section dans l'onglet Texte : la barre de mise en forme au-dessus d'un texte avec deux titres, une liste à puces et un tableau, puis les boutons Enregistrer et Annuler.",
  ),
  editeurMarkdown: figure(
    "editeur-markdown.webp",
    "Le même texte dans l'onglet Markdown : les titres commencent par ##, la liste par des tirets et le tableau s'écrit avec des barres verticales. Le bouton Aperçu est en haut à droite.",
  ),
} as const satisfies Record<string, GuideFigure>;

export type GuideFigureKey = keyof typeof GUIDE_FIGURES;

/** Public URL of a screenshot. */
export function figureSrc(key: GuideFigureKey): string {
  return `/${GUIDE_ASSETS_DIR}/${GUIDE_FIGURES[key].file}`;
}
