import { GROUP_COMPANY, PUBLISHER, SUPPORT_EMAIL } from "./publisher";
import type { LegalDocument } from "./types";

// Offers of the business model (Jira epic KRB-173). Prices are in FCFA,
// before tax. When billing ships, its plans must match these numbers.
export const OFFERS = {
  trial: { days: 14, members: 5, reports: 1, aiDrafts: 20 },
  independant: { monthly: 15_000, members: 3, activeReports: 3, aiDraftsPerMonth: 60 },
  cabinet: { monthly: 49_000, members: 10, aiDraftsPerMonth: 250 },
  institution: { fromMonthly: 150_000 },
  passMission: { price: 39_000, days: 90, members: 10, aiDrafts: 80 },
  packIa: { price: 12_000, aiDrafts: 100 },
  graceDays: 7,
} as const;

const amount = new Intl.NumberFormat("fr-FR");

/** "15 000 FCFA HT", with spaces that never break the amount over two lines. */
export function fcfaHt(value: number) {
  return `${amount.format(value)}\u00a0FCFA\u00a0HT`;
}

const { trial, independant, cabinet, institution, passMission, packIa, graceDays } = OFFERS;

export const cgv: LegalDocument = {
  updatedAt: "2026-10-14",
  intro: [
    "Les présentes conditions générales de vente (CGV) s'appliquent à toute commande d'une offre KolabReport par une organisation cliente. Elles complètent les [conditions générales d'utilisation](/cgu).",
  ],
  sections: [
    {
      id: "vendeur",
      title: "Vendeur",
      body: [
        `Le vendeur est ${PUBLISHER.name}, établissement immatriculé en République du Bénin, ${PUBLISHER.address}, RCCM ${PUBLISHER.rccm}, IFU ${PUBLISHER.ifu}, joignable à ${SUPPORT_EMAIL}.`,
        `${GROUP_COMPANY.name}, société du même groupe établie aux États-Unis, n'est pas partie aux ventes facturées en FCFA.`,
      ],
    },
    {
      id: "champ-application",
      title: "Champ d'application",
      body: [
        "Les offres KolabReport sont réservées aux professionnels : cabinets d'audit, bureaux d'études, consultants et autres organisations qui les achètent pour leur activité. Elles ne sont pas destinées aux consommateurs.",
        "Toute commande vaut acceptation des présentes CGV. Elles priment sur les conditions d'achat du client, sauf accord écrit contraire. Pour l'offre Institution, le devis signé prime sur les CGV pour les points qu'il traite.",
        "La personne qui commande déclare avoir le pouvoir d'engager l'organisation.",
      ],
    },
    {
      id: "definitions",
      title: "Définitions",
      body: [
        {
          facts: [
            ["Client", "L'organisation qui commande une offre."],
            [
              "Membre",
              "Un utilisateur d'un espace du client avec le rôle propriétaire, administrateur ou expert. Les limites de membres de chaque offre comptent ces rôles.",
            ],
            [
              "Lecteur",
              "Un utilisateur avec le rôle lecteur. Les lecteurs sont gratuits et en nombre illimité dans toutes les offres.",
            ],
            ["Rapport actif", "Un rapport qui n'est pas au statut final."],
            [
              "Brouillon IA",
              "Une demande de brouillon de section traitée par l'IA. Chaque brouillon produit compte pour un, qu'il soit accepté ou non.",
            ],
            ["Période", "La durée payée d'avance : un mois, un trimestre ou un an."],
          ],
        },
      ],
    },
    {
      id: "offres-et-prix",
      title: "Offres et prix",
      body: [
        {
          table: {
            caption: "Offres KolabReport et leurs limites",
            head: ["Offre", "Prix", "Membres", "Rapports", "Brouillons IA", "À savoir"],
            rows: [
              [
                "Essai gratuit",
                `Gratuit pendant ${trial.days} jours, sans carte bancaire`,
                `${trial.members}`,
                `${trial.reports}`,
                `${trial.aiDrafts} au total`,
                "Une seule fois par organisation",
              ],
              [
                "Indépendant",
                `${fcfaHt(independant.monthly)} par mois`,
                `${independant.members}`,
                `${independant.activeReports} rapports actifs`,
                `${independant.aiDraftsPerMonth} par mois`,
                "Paiement au mois, au trimestre ou à l'année",
              ],
              [
                "Cabinet",
                `${fcfaHt(cabinet.monthly)} par mois`,
                `${cabinet.members}`,
                "Illimités",
                `${cabinet.aiDraftsPerMonth} par mois`,
                "Modèles de prompts personnalisés. Paiement au mois, au trimestre ou à l'année.",
              ],
              [
                "Institution",
                `Sur devis, à partir de ${fcfaHt(institution.fromMonthly)} par mois`,
                "Selon le devis",
                "Selon le devis",
                "Selon le devis",
                "Engagement d'un an, paiement par virement bancaire",
              ],
              [
                "Pass Mission",
                `${fcfaHt(passMission.price)} par rapport`,
                `${passMission.members}`,
                "1",
                `${passMission.aiDrafts} pour ce rapport`,
                `Valable ${passMission.days} jours`,
              ],
              [
                "Pack IA",
                `${fcfaHt(packIa.price)} les ${packIa.aiDrafts} brouillons`,
                "Sans objet",
                "Sans objet",
                `${packIa.aiDrafts} de plus`,
                "S'ajoute à une offre payante en cours",
              ],
            ],
          },
        },
        "Les lecteurs sont gratuits et en nombre illimité dans toutes les offres.",
        "Les prix sont indiqués en francs CFA (FCFA), hors taxes (HT). Les taxes applicables selon la réglementation en vigueur s'ajoutent au prix HT et figurent sur la facture.",
        "Les offres Indépendant et Cabinet se paient par mois, par trimestre ou par an. Le trimestre coûte trois mois. L'année coûte dix mois : deux mois sont offerts.",
        "Le quota mensuel de brouillons IA repart à zéro chaque mois de la période. Les brouillons non utilisés ne sont pas reportés sur le mois suivant.",
        "Le prix applicable est celui affiché au moment de la commande.",
      ],
    },
    {
      id: "essai-gratuit",
      title: "Essai gratuit",
      body: [
        `Une organisation peut essayer KolabReport gratuitement pendant ${trial.days} jours, sans carte bancaire, dans les limites du [tableau des offres](#offres-et-prix). Un seul essai est accordé par client : une nouvelle organisation créée par le même propriétaire n'ouvre pas de nouvel essai.`,
        `À la fin de l'essai, le client peut commander une offre. Sans commande, le [délai de grâce](#fin-de-periode) de ${graceDays} jours s'applique, puis l'espace passe en lecture seule : les membres peuvent encore lire les rapports et les propriétaires et administrateurs peuvent les exporter, mais personne ne peut plus les modifier.`,
        "L'essai ne devient jamais un abonnement payant sans action du client.",
      ],
    },
    {
      id: "commande",
      title: "Commande",
      body: [
        `Le client commande depuis KolabReport, en choisissant une offre et une période, ou en écrivant à ${SUPPORT_EMAIL}. Pour l'offre Institution, il demande un devis à la même adresse.`,
        `La commande est ferme une fois le paiement confirmé. ${PUBLISHER.name} envoie alors une confirmation par e-mail.`,
        `${PUBLISHER.name} peut refuser une commande pour un motif légitime, par exemple un litige de paiement antérieur.`,
      ],
    },
    {
      id: "paiement",
      title: "Paiement",
      body: [
        "Les offres se paient d'avance, pour toute la période choisie.",
        `Le paiement passe par FedaPay, par mobile money ou par carte bancaire. Les données de paiement sont saisies chez FedaPay, selon ses propres conditions. ${PUBLISHER.name} ne reçoit ni le numéro de carte ni le code mobile money.`,
        "L'offre Institution se paie par virement bancaire, selon les conditions du devis.",
        "L'offre s'ouvre dès que le paiement est confirmé. Un paiement refusé ou annulé n'ouvre aucun accès.",
      ],
    },
    {
      id: "duree-et-renouvellement",
      title: "Durée et renouvellement",
      body: [
        "Une offre dure le temps de la période payée : un mois, un trimestre ou un an à partir de la confirmation du paiement.",
        "Il n'y a ni prélèvement automatique ni reconduction tacite. Pour continuer, le client paie une nouvelle période.",
        `${PUBLISHER.name} envoie des rappels par e-mail aux propriétaires avant la fin de la période.`,
        "Si le client paie avant la fin de la période en cours, la nouvelle période commence à la fin de celle-ci : aucun jour n'est perdu.",
      ],
    },
    {
      id: "fin-de-periode",
      title: "Fin de période, délai de grâce et lecture seule",
      body: [
        `À la fin d'une période non renouvelée, le client garde un accès complet pendant un délai de grâce de ${graceDays} jours. Une période payée pendant ce délai commence à la date de fin de la période précédente.`,
        "Après ce délai, l'espace passe en lecture seule. Les membres peuvent lire les rapports et les propriétaires et administrateurs peuvent les exporter en Word ou en PDF. Personne ne peut plus créer ou modifier un rapport, déposer un livrable ni demander un brouillon IA.",
        "Le paiement d'une nouvelle période rétablit l'accès complet, avec toutes les données.",
        `Les données d'un espace en lecture seule restent conservées. Avant de les supprimer, ${PUBLISHER.name} prévient les propriétaires par e-mail au moins 30 jours à l'avance, pour leur laisser le temps d'exporter leurs rapports. Le sort des données à la fin du contrat est précisé dans l'[accord de traitement des données](/accord-traitement-donnees#fin-du-contrat).`,
      ],
    },
    {
      id: "pass-mission",
      title: "Pass Mission",
      body: [
        `Le Pass Mission couvre un seul rapport pendant ${passMission.days} jours à partir de la confirmation du paiement, avec ${passMission.members} membres et ${passMission.aiDrafts} brouillons IA pour ce rapport. Il convient à une mission ponctuelle, sans abonnement.`,
        `À la fin des ${passMission.days} jours, les règles de [fin de période](#fin-de-periode) s'appliquent au rapport : délai de grâce de ${graceDays} jours, puis lecture seule.`,
      ],
    },
    {
      id: "pack-ia",
      title: "Pack IA",
      body: [
        `Le Pack IA ajoute ${packIa.aiDrafts} brouillons IA pour ${fcfaHt(packIa.price)}. Il s'achète en plus d'une offre payante en cours : Indépendant, Cabinet, Institution ou Pass Mission.`,
        "Les brouillons du pack servent une fois le quota de l'offre épuisé. Ils restent valables 12 mois après l'achat, tant que le client a une offre payante en cours.",
        "Le Pack IA ne s'achète pas pendant l'essai gratuit. Dix packs au plus peuvent être en cours en même temps.",
      ],
    },
    {
      id: "changement-offre",
      title: "Changement d'offre",
      body: [
        "Le client peut passer à une offre supérieure à tout moment. Le changement prend effet dès le paiement de la différence de prix, calculée au prorata des jours restants de la période en cours. La date de fin de la période ne change pas.",
        "Le passage à une offre inférieure prend effet au début de la période suivante. Le client doit alors respecter les limites de la nouvelle offre : nombre de membres et de rapports actifs.",
      ],
    },
    {
      id: "remboursement",
      title: "Remboursement",
      body: [
        `Les offres sont réservées aux professionnels : elles ne donnent pas lieu à un droit de rétractation. L'essai gratuit de ${trial.days} jours permet de tester KolabReport avant de payer.`,
        "Une période commencée n'est pas remboursée, ni en tout ni en partie, même si le client cesse d'utiliser le service avant la fin. Un Pass Mission commencé et un Pack IA acheté ne sont pas remboursés non plus.",
        "Font exception :",
        {
          list: [
            "un paiement fait deux fois par erreur pour la même commande, remboursé en entier ;",
            `une résiliation par le client pour un manquement grave de ${PUBLISHER.name} (voir [Résiliation](#resiliation)), qui donne lieu au remboursement de la part non utilisée de la période ;`,
            "l'opposition à un nouveau sous-traitant, dans le cas prévu par l'[accord de traitement des données](/accord-traitement-donnees#sous-traitants-ulterieurs) ;",
            "les cas où la loi impose un remboursement.",
          ],
        },
        "Un remboursement est fait par le moyen de paiement d'origine lorsque c'est possible, sinon par virement, dans un délai de 30 jours.",
      ],
    },
    {
      id: "factures",
      title: "Factures et reçus",
      body: [
        `${PUBLISHER.name} émet un reçu pour chaque paiement et une facture conforme à la réglementation en vigueur. Ils sont envoyés par e-mail à l'adresse donnée lors de la commande.`,
        "Le client fournit des informations de facturation exactes : raison sociale, adresse et, le cas échéant, numéro d'identification fiscale.",
      ],
    },
    {
      id: "institution",
      title: "Offre Institution et devis",
      body: [
        `L'offre Institution s'adresse aux organisations qui ont besoin de plus de membres, de plus de brouillons IA ou de conditions particulières. Son prix commence à ${fcfaHt(institution.fromMonthly)} par mois. Elle se souscrit pour un an, sur devis.`,
        "Le devis précise les limites, le prix, sa propre durée de validité et, le cas échéant, un niveau de service. Il est payé par virement bancaire dans le délai qu'il indique.",
        "Le devis signé et les présentes CGV forment le contrat. En cas de contradiction, le devis prime.",
      ],
    },
    {
      id: "obligations-client",
      title: "Obligations du client",
      body: [
        "Le client s'engage à :",
        {
          list: [
            "payer le prix de l'offre choisie ;",
            "faire respecter les [conditions générales d'utilisation](/cgu) par ses membres ;",
            "garder dans chaque espace un propriétaire joignable à son adresse e-mail ;",
            "déposer uniquement des contenus pour lesquels il a les droits et une base légale, et respecter l'[accord de traitement des données](/accord-traitement-donnees) en tant que responsable de traitement ;",
            "exporter ses rapports avant la suppression de ses données.",
          ],
        },
      ],
    },
    {
      id: "responsabilite",
      title: "Responsabilité",
      body: [
        `${PUBLISHER.name} fournit le service dans le cadre d'une obligation de moyens.`,
        `${PUBLISHER.name} n'est pas responsable des dommages indirects, comme une perte de chiffre d'affaires, de bénéfice, de clientèle ou d'image, ni des conséquences d'un rapport ou d'un brouillon IA que le client a validé.`,
        `Toutes causes confondues, la responsabilité de ${PUBLISHER.name} envers le client est limitée au montant hors taxes payé par le client pour KolabReport pendant les 12 mois qui précèdent le fait à l'origine du dommage.`,
        `Ces limites ne s'appliquent pas en cas de faute lourde ou intentionnelle de ${PUBLISHER.name}, ni lorsque la loi les interdit.`,
      ],
    },
    {
      id: "force-majeure",
      title: "Force majeure",
      body: [
        "Aucune partie n'est responsable d'un manquement causé par un cas de force majeure au sens du droit applicable, par exemple une coupure générale d'électricité ou de télécommunications, une catastrophe naturelle ou une décision d'une autorité.",
        "Si le cas de force majeure dure plus de 30 jours, chaque partie peut mettre fin au contrat par écrit.",
      ],
    },
    {
      id: "donnees-personnelles",
      title: "Données personnelles",
      body: [
        `Les données de facturation sont traitées comme le décrit la [politique de confidentialité](/confidentialite). Pour le contenu de ses espaces, le client est responsable de traitement et ${PUBLISHER.name} est son sous-traitant. L'[accord de traitement des données](/accord-traitement-donnees) fait partie du contrat.`,
      ],
    },
    {
      id: "resiliation",
      title: "Résiliation",
      body: [
        "Le contrat n'engage le client que pour la période payée. Pour l'arrêter, il suffit de ne pas renouveler.",
        `En cas de manquement grave d'une partie, l'autre peut résilier le contrat par écrit si le manquement n'est pas corrigé 15 jours après une mise en demeure. ${PUBLISHER.name} peut résilier sans délai en cas de fraude, d'atteinte à la sécurité du service ou de non-paiement d'un devis Institution.`,
        `Si ${PUBLISHER.name} résilie pour un manquement du client, la période en cours n'est pas remboursée. Si le client résilie pour un manquement grave de ${PUBLISHER.name}, la part non utilisée de la période lui est remboursée.`,
        "Après la fin du contrat, les règles de [fin de période](#fin-de-periode) et l'[accord de traitement des données](/accord-traitement-donnees#fin-du-contrat) s'appliquent.",
      ],
    },
    {
      id: "modifications",
      title: "Modification des prix et des CGV",
      body: [
        `${PUBLISHER.name} peut modifier ses prix et les présentes CGV. Les changements s'appliquent aux commandes passées après leur publication. Une période déjà payée n'est pas modifiée.`,
        "Pour un changement de prix, les propriétaires sont prévenus par e-mail au moins 30 jours avant qu'il s'applique.",
      ],
    },
    {
      id: "droit-applicable",
      title: "Droit applicable et litiges",
      body: [
        "Les présentes CGV sont régies par le droit de la République du Bénin.",
        `En cas de litige, les parties cherchent d'abord une solution amiable, par écrit à ${SUPPORT_EMAIL}. Sans accord dans les 30 jours, le litige est porté devant les juridictions compétentes de Cotonou.`,
      ],
    },
  ],
};
