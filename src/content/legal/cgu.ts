import { PUBLISHER, SUPPORT_EMAIL } from "./publisher";
import type { LegalDocument } from "./types";

export const cgu: LegalDocument = {
  updatedAt: "2026-10-15",
  intro: [
    "Les présentes conditions générales d'utilisation (CGU) fixent les règles d'utilisation de KolabReport. Elles s'appliquent à toute personne qui crée un compte ou utilise le service, quel que soit son rôle.",
  ],
  sections: [
    {
      id: "objet",
      title: "Objet",
      body: [
        "KolabReport est un service en ligne qui permet à une organisation (cabinet d'audit, bureau d'études, consultant) de rédiger des rapports d'expertise à plusieurs : découpage du rapport en sections, attribution des sections aux experts, dépôt de livrables, brouillons proposés par l'IA, suivi de l'avancement et export du rapport final en Word ou en PDF.",
        `Le service est édité par ${PUBLISHER.name} (voir les [mentions légales](/mentions-legales)).`,
        "L'achat d'une offre par une organisation est régi par les [conditions générales de vente](/cgv). Le traitement des données personnelles est décrit dans la [politique de confidentialité](/confidentialite) et dans l'[accord de traitement des données](/accord-traitement-donnees).",
      ],
    },
    {
      id: "definitions",
      title: "Définitions",
      body: [
        {
          facts: [
            ["Service", "Le site et l'application KolabReport, y compris les e-mails qu'ils envoient."],
            [
              "Organisation",
              "L'entreprise ou l'entité cliente qui utilise KolabReport pour son activité, par exemple un cabinet.",
            ],
            ["Espace de travail", "L'espace d'une organisation où ses membres rédigent leurs rapports."],
            ["Utilisateur", "Toute personne qui a un compte KolabReport."],
            [
              "Membre",
              "Un utilisateur ajouté à un espace de travail avec un rôle : propriétaire, administrateur, expert ou lecteur.",
            ],
            [
              "Contenu",
              "Tout ce qu'un utilisateur dépose ou écrit dans le service : rapports, sections, livrables, commentaires, modèles de prompts.",
            ],
            [
              "Brouillon IA",
              "Un texte proposé par un modèle d'intelligence artificielle pour une section, à partir de ses consignes et de ses livrables.",
            ],
          ],
        },
      ],
    },
    {
      id: "compte",
      title: "Compte",
      body: [
        "KolabReport s'adresse aux professionnels. Pour créer un compte, vous devez être majeur et agir dans le cadre de votre activité professionnelle.",
        "Vous donnez une adresse e-mail valide et vous la confirmez avec le lien reçu. Vous gardez votre mot de passe secret. Un compte correspond à une seule personne : ne le partagez pas.",
        `Si vous pensez que quelqu'un d'autre utilise votre compte, changez votre mot de passe et écrivez à ${SUPPORT_EMAIL}.`,
        "La personne qui crée une organisation pour le compte d'une entreprise déclare avoir le pouvoir de l'engager.",
      ],
    },
    {
      id: "roles-et-invitations",
      title: "Rôles et invitations",
      body: [
        "Chaque membre d'un espace de travail a un rôle :",
        {
          list: [
            "**Propriétaire** : gère l'espace, ses rapports, ses sections et tous ses membres, y compris les autres propriétaires.",
            "**Administrateur** : gère les rapports, les sections et les membres, sauf les propriétaires.",
            "**Expert** : rédige les sections qui lui sont attribuées et y dépose des livrables.",
            "**Lecteur** : consulte les rapports sans les modifier.",
          ],
        },
        "Les propriétaires et les administrateurs invitent des personnes par e-mail. Un lien d'invitation vaut 7 jours, ne sert qu'une fois et ne peut être accepté que par l'adresse e-mail à laquelle il a été envoyé. Un espace garde toujours au moins un propriétaire.",
        "L'organisation choisit qui elle invite et avec quel rôle. Elle retire l'accès des personnes qui ne doivent plus l'avoir, par exemple quand un collaborateur quitte le cabinet.",
      ],
    },
    {
      id: "utilisation-acceptable",
      title: "Utilisation acceptable",
      body: [
        "Vous utilisez KolabReport de façon loyale et conforme à la loi. Il est interdit notamment :",
        {
          list: [
            "de déposer un contenu illicite, diffamatoire ou qui porte atteinte aux droits d'un tiers, par exemple au droit d'auteur, au secret professionnel ou à la vie privée ;",
            "de déposer des données personnelles sans base légale, ou des données sensibles qui ne sont pas nécessaires au rapport ;",
            "de tenter d'accéder à un espace de travail, un compte ou des données qui ne sont pas les vôtres ;",
            "de contourner les limites d'usage, les quotas de l'offre ou les mesures de sécurité, y compris celles des fonctions d'IA ;",
            "de déposer des fichiers malveillants ou de chercher à perturber le service ;",
            "d'extraire les données du service par des moyens automatisés qu'il ne prévoit pas, ou de copier le service ;",
            `de revendre l'accès au service ou de le mettre à disposition de tiers sans accord écrit de ${PUBLISHER.name}.`,
          ],
        },
        `${PUBLISHER.name} peut retirer un contenu manifestement illicite qui lui est signalé.`,
      ],
    },
    {
      id: "contenus",
      title: "Vos contenus",
      body: [
        `L'organisation et ses membres restent propriétaires de leurs contenus. ${PUBLISHER.name} n'acquiert aucun droit sur eux, en dehors de la licence ci-dessous.`,
        `Pour faire fonctionner le service, vous accordez à ${PUBLISHER.name} une licence non exclusive, gratuite et mondiale pour héberger, copier, sauvegarder, analyser (extraction du texte des livrables), transmettre à ses sous-traitants (dont le fournisseur d'IA quand un membre demande un brouillon), afficher et exporter vos contenus. Cette licence vaut pour la durée du contrat et le temps nécessaire à la suppression des données. Elle sert uniquement à fournir le service.`,
        `${PUBLISHER.name} n'utilise pas vos contenus pour entraîner des modèles d'IA et ne les rend pas publics.`,
        `Vous garantissez avoir le droit de déposer vos contenus et, pour les données personnelles qu'ils contiennent, une base légale pour le faire. Pour ces données, l'organisation est responsable de traitement et ${PUBLISHER.name} est son sous-traitant ([accord de traitement des données](/accord-traitement-donnees)).`,
        "Gardez une copie de vos rapports importants. Les exports Word et PDF servent à cela.",
      ],
    },
    {
      id: "brouillons-ia",
      title: "Brouillons rédigés par l'IA",
      body: [
        `Un brouillon IA est une proposition de texte. Il peut contenir des erreurs, des oublis, des chiffres mal lus ou des affirmations inventées. Il ne constitue pas un avis professionnel de ${PUBLISHER.name}.`,
        "Un brouillon n'entre dans la section que si un membre l'accepte, tel quel ou après modification. Avant de l'accepter, vous le relisez et vous vérifiez les faits, les chiffres et les sources. Le contenu du rapport final et son usage relèvent de la seule responsabilité de l'organisation.",
        "Avant l'envoi au fournisseur d'IA, certaines données personnelles sont masquées, mais pas toutes. La [politique de confidentialité](/confidentialite#intelligence-artificielle) précise lesquelles.",
        `Les demandes de brouillons sont limitées par personne et par heure, par espace et par mois, et par le quota de l'offre ([conditions générales de vente](/cgv#offres-et-prix)). ${PUBLISHER.name} peut suspendre la fonction de brouillon IA, par exemple en cas de panne du fournisseur ou d'usage anormal.`,
      ],
    },
    {
      id: "disponibilite",
      title: "Disponibilité du service",
      body: [
        `${PUBLISHER.name} fait ses meilleurs efforts pour que KolabReport soit accessible à tout moment. C'est une obligation de moyens. Le service peut être interrompu pour une maintenance, une mise à jour, une panne d'un prestataire ou d'un réseau, ou un cas de force majeure. Nous prévenons des maintenances prévues lorsque c'est possible.`,
        "Aucun niveau de service chiffré n'est garanti, sauf accord écrit, par exemple dans un devis pour l'offre Institution.",
        "Installé comme une application, KolabReport garde lisibles hors ligne les pages déjà consultées. Le dépôt de livrables et la demande de brouillons IA demandent une connexion.",
        `${PUBLISHER.name} peut faire évoluer le service : ajouter, modifier ou retirer une fonction.`,
      ],
    },
    {
      id: "suspension",
      title: "Suspension",
      body: [
        `${PUBLISHER.name} peut suspendre, en tout ou en partie, l'accès d'un utilisateur ou d'une organisation :`,
        {
          list: [
            "en cas de manquement grave aux présentes CGU, notamment à l'article [Utilisation acceptable](#utilisation-acceptable) ;",
            "en cas de risque pour la sécurité du service ou des autres clients ;",
            "sur demande d'une autorité ou lorsque la loi l'impose.",
          ],
        },
        "Sauf urgence, nous prévenons avant la suspension et laissons un délai raisonnable pour corriger.",
        "À la fin d'une période payée et non renouvelée, l'espace passe en lecture seule comme le prévoient les [conditions générales de vente](/cgv#fin-de-periode). Ce n'est pas une suspension.",
      ],
    },
    {
      id: "responsabilite",
      title: "Responsabilité",
      body: [
        `${PUBLISHER.name} répond du fonctionnement du service dans le cadre d'une obligation de moyens. Elle n'est pas responsable :`,
        {
          list: [
            "des contenus déposés par les utilisateurs, ni de l'usage fait des rapports ;",
            "des décisions prises sur la base d'un brouillon IA ou d'un rapport ;",
            "des dommages indirects, comme une perte de chiffre d'affaires, de clientèle, d'image ou de chance ;",
            "d'un usage du service contraire aux présentes CGU ;",
            "des interruptions dues à un cas de force majeure ou à un réseau qu'elle ne maîtrise pas.",
          ],
        },
        `Envers une organisation cliente, la responsabilité de ${PUBLISHER.name} est limitée comme le prévoient les [conditions générales de vente](/cgv#responsabilite). Ces limites ne s'appliquent pas en cas de faute lourde ou intentionnelle, ni lorsque la loi les interdit.`,
        "Chaque utilisateur répond de l'usage de son compte et des contenus qu'il dépose.",
      ],
    },
    {
      id: "propriete-intellectuelle",
      title: "Propriété intellectuelle du service",
      body: [
        `KolabReport, son code, son design et sa documentation appartiennent à ${PUBLISHER.name}. Vous recevez un droit d'utilisation personnel, non exclusif et non transmissible, pour la durée de votre accès. Vous ne pouvez pas copier, modifier ou décompiler le service, sauf dans les cas permis par la loi.`,
        `${PUBLISHER.name} peut utiliser librement et sans contrepartie les suggestions d'amélioration que vous lui envoyez.`,
      ],
    },
    {
      id: "donnees-personnelles",
      title: "Données personnelles",
      body: [
        `${PUBLISHER.name} traite vos données comme le décrit la [politique de confidentialité](/confidentialite). Pour le contenu des espaces de travail, l'[accord de traitement des données](/accord-traitement-donnees) s'applique.`,
      ],
    },
    {
      id: "fin-utilisation",
      title: "Fin de l'utilisation",
      body: [
        `Vous pouvez arrêter d'utiliser KolabReport à tout moment et supprimer vous-même votre compte depuis la page **Mon compte** de l'application. Vous pouvez aussi demander sa suppression à ${SUPPORT_EMAIL}.`,
        "La suppression du compte n'est pas possible tant que vous êtes propriétaire d'une organisation ou seul propriétaire d'un espace de travail. Transférez d'abord l'organisation à un propriétaire de l'un de ses espaces, nommez un autre propriétaire de l'espace, ou supprimez l'espace ou l'organisation. La page **Mon compte** indique quoi faire.",
        "Un propriétaire ou un administrateur peut retirer un membre d'un espace. Le membre perd l'accès à cet espace mais garde son compte.",
        `${PUBLISHER.name} peut fermer un compte en cas de manquement grave ou répété aux présentes CGU, après une suspension restée sans effet.`,
        "La fin du contrat d'une organisation est régie par les [conditions générales de vente](/cgv#resiliation) et l'[accord de traitement des données](/accord-traitement-donnees#fin-du-contrat).",
      ],
    },
    {
      id: "modifications",
      title: "Modification des CGU",
      body: [
        `${PUBLISHER.name} peut modifier les présentes CGU. Pour un changement important, elle prévient les utilisateurs par e-mail ou dans l'application au moins 30 jours avant son entrée en vigueur, sauf si la loi ou la sécurité du service impose d'aller plus vite.`,
        "Utiliser KolabReport après cette date vaut acceptation des nouvelles CGU. Si vous les refusez, vous pouvez cesser d'utiliser le service et supprimer votre compte.",
      ],
    },
    {
      id: "droit-applicable",
      title: "Droit applicable et litiges",
      body: [
        "Les présentes CGU sont régies par le droit de la République du Bénin.",
        `En cas de désaccord, écrivez d'abord à ${SUPPORT_EMAIL} pour chercher une solution amiable. Sans solution dans les 30 jours, le litige est porté devant les juridictions compétentes de Cotonou.`,
      ],
    },
  ],
};
