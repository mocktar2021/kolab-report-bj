import { PUBLISHER, SUPPORT_EMAIL } from "./publisher";
import type { LegalDocument } from "./types";

// Data processing agreement between a client firm (controller) and
// Mocktar Technologies (processor). Security measures and retention come
// from docs/gdpr and docs/operations.

export const accordTraitement: LegalDocument = {
  updatedAt: "2026-10-14",
  intro: [
    `Le présent accord de traitement des données (l'Accord) fait partie du contrat entre l'organisation cliente (le Client) et ${PUBLISHER.name} pour l'utilisation de KolabReport. Il s'applique dès que le Client accepte les [conditions générales d'utilisation](/cgu) ou commande une offre selon les [conditions générales de vente](/cgv).`,
    `Il fixe les engagements de ${PUBLISHER.name} lorsqu'elle traite des données personnelles pour le compte du Client, conformément à la loi n° 2017-20 du 20 avril 2018 portant code du numérique en République du Bénin et, lorsqu'il s'applique, à l'article 28 du règlement général sur la protection des données (RGPD).`,
  ],
  sections: [
    {
      id: "roles",
      title: "Rôles des parties",
      body: [
        `Pour les données que le Client et ses membres déposent dans KolabReport, le Client est responsable de traitement et ${PUBLISHER.name} est sous-traitant.`,
        "Ces données comprennent le contenu des espaces de travail (rapports, sections, livrables et leur texte extrait, brouillons IA, exports, modèles de prompts, historique des statuts, notifications) et leur composition (membres, rôles, invitations).",
        `Pour les comptes des utilisateurs, la facturation, la sécurité du service et la mesure de l'usage de l'IA, ${PUBLISHER.name} est responsable de traitement. Ces traitements sont décrits dans la [politique de confidentialité](/confidentialite).`,
      ],
    },
    {
      id: "description",
      title: "Description du traitement",
      body: [
        {
          facts: [
            ["Objet", "Fournir le service KolabReport au Client."],
            [
              "Nature",
              "Hébergement, stockage, sauvegarde, extraction du texte des livrables, affichage, rédaction de brouillons par l'IA à la demande d'un membre, export en Word et en PDF, envoi des e-mails du service, suppression.",
            ],
            [
              "Finalité",
              "Permettre aux membres du Client de rédiger, relire et livrer leurs rapports à plusieurs.",
            ],
            [
              "Personnes concernées",
              "Les membres du Client et les personnes qu'il invite. Toute personne citée dans un rapport ou un livrable, par exemple les clients du Client, des bénéficiaires ou le personnel d'une structure auditée.",
            ],
            [
              "Catégories de données",
              "Identité et coordonnées professionnelles (nom, e-mail, fonction), rôle dans l'espace, contenu des rapports et des livrables, brouillons, données d'usage. Le contenu dépend de ce que le Client dépose : des données sensibles ne peuvent pas être exclues.",
            ],
            [
              "Durée",
              "La durée du contrat, puis le temps nécessaire à la restitution et à la suppression des données (voir [Fin du contrat](#fin-du-contrat)).",
            ],
          ],
        },
      ],
    },
    {
      id: "instructions",
      title: "Instructions du Client",
      body: [
        `${PUBLISHER.name} traite les données uniquement sur instruction documentée du Client. Ces instructions sont le contrat, le présent Accord et les actions des membres du Client dans KolabReport, par exemple déposer un livrable, demander un brouillon ou supprimer un fichier. Toute autre instruction est donnée par écrit par un propriétaire de l'espace concerné.`,
        `Si une instruction lui paraît contraire à la loi, ${PUBLISHER.name} en informe le Client sans tarder.`,
        `Si la loi oblige ${PUBLISHER.name} à traiter les données autrement, elle en informe le Client avant le traitement, sauf si la loi l'interdit.`,
      ],
    },
    {
      id: "confidentialite",
      title: "Confidentialité",
      body: [
        "Les personnes autorisées à traiter les données s'engagent à la confidentialité ou y sont tenues par la loi. Elles n'accèdent au contenu des espaces que lorsque c'est nécessaire au service, au support demandé par le Client ou au respect de la loi.",
      ],
    },
    {
      id: "securite",
      title: "Mesures de sécurité",
      body: [
        `${PUBLISHER.name} met en place les mesures suivantes et les adapte à l'évolution des risques :`,
        {
          list: [
            "Hébergement de la base de données, des fichiers et des fonctions de l'application dans la région de Paris, dans l'Union européenne.",
            "Isolement des données par espace de travail et par rôle dans chaque table de la base (sécurité au niveau des lignes). Un expert ne modifie que les sections qui lui sont attribuées. Un rapport final reste figé tant qu'un propriétaire ne l'a pas rouvert.",
            "Fichiers rangés dans un espace de stockage privé et ouverts par des liens signés valables 60 secondes, après un contrôle d'accès. Chaque dépôt est vérifié : taille, type, premiers octets du fichier, scripts refusés dans les images SVG.",
            "Mots de passe enregistrés sous forme d'empreinte, adresse e-mail confirmée, liens d'invitation à usage unique gardés sous forme d'empreinte.",
            "Connexions chiffrées (HTTPS avec HSTS), politique de sécurité du contenu sur chaque page, clés secrètes gardées sur le serveur et distinctes pour chaque environnement.",
            "Brouillons IA seulement à la demande d'un membre, masquage des données personnelles repérables avant l'envoi, protection contre les instructions cachées dans les livrables, limites d'usage par personne et par espace. Aucun identifiant de l'utilisateur n'est envoyé au fournisseur d'IA.",
            "Suivi des erreurs sans nom, sans e-mail et sans adresse IP, avec masquage des données repérables dans les messages.",
            "Sauvegarde chiffrée de la base de données chaque nuit et copie des fichiers dans l'Union européenne.",
            "Effacement, à la déconnexion, des pages gardées pour la lecture hors ligne.",
          ],
        },
      ],
    },
    {
      id: "sous-traitants-ulterieurs",
      title: "Sous-traitants ultérieurs",
      body: [
        `Le Client autorise ${PUBLISHER.name} à faire appel aux sous-traitants listés dans la [politique de confidentialité](/confidentialite#sous-traitants).`,
        `${PUBLISHER.name} impose à chacun, par contrat, des obligations de protection des données au moins équivalentes à celles du présent Accord. Elle reste responsable envers le Client de leur respect.`,
        `Avant d'ajouter ou de remplacer un sous-traitant qui reçoit le contenu des espaces, ${PUBLISHER.name} met la liste à jour et prévient les propriétaires par e-mail au moins 30 jours avant. Pendant ce délai, le Client peut s'opposer par écrit pour un motif lié à la protection des données. Si aucune solution n'est trouvée, il peut mettre fin au contrat et la part payée et non utilisée de la période lui est remboursée.`,
      ],
    },
    {
      id: "transferts",
      title: "Transferts de données",
      body: [
        `Les données sont hébergées dans l'Union européenne. Certains sous-traitants sont établis aux États-Unis ou peuvent accéder aux données depuis d'autres pays. ${PUBLISHER.name} encadre ces transferts par les garanties prévues par la loi applicable, notamment les clauses contractuelles types de la Commission européenne ou la certification du sous-traitant au Data Privacy Framework UE-États-Unis, et respecte les conditions de transfert fixées par le code du numérique.`,
        "Le Client autorise ces transferts vers les sous-traitants listés.",
      ],
    },
    {
      id: "demandes-des-personnes",
      title: "Demandes des personnes concernées",
      body: [
        `Si une personne s'adresse à ${PUBLISHER.name} au sujet du contenu d'un espace, ${PUBLISHER.name} transmet la demande au Client sans tarder et n'y répond pas elle-même, sauf instruction du Client.`,
        `${PUBLISHER.name} aide le Client à répondre, dans la mesure du possible :`,
        {
          list: [
            "depuis l'application, les membres exportent les rapports, téléchargent et suppriment les livrables, corrigent les sections et retirent des membres, selon leur rôle ;",
            `sur instruction écrite d'un propriétaire, ${PUBLISHER.name} recherche les données d'une personne dans l'espace du Client, les extrait ou les supprime, y compris dans les brouillons IA conservés.`,
          ],
        },
      ],
    },
    {
      id: "violation",
      title: "Violation de données",
      body: [
        `${PUBLISHER.name} notifie au Client toute violation de données personnelles qui touche ses données, dans les meilleurs délais et au plus tard 48 heures après en avoir eu connaissance.`,
        "La notification décrit, dans la mesure du possible, la nature de la violation, les catégories et le nombre approximatif de personnes et de données concernées, les conséquences probables, les mesures prises ou proposées, et un contact. Les informations manquantes sont transmises dès qu'elles sont connues.",
        `${PUBLISHER.name} aide le Client à notifier l'autorité de contrôle et, si nécessaire, les personnes concernées. Lorsque le RGPD s'applique, l'autorité doit être notifiée dans les 72 heures.`,
      ],
    },
    {
      id: "assistance",
      title: "Aide au Client",
      body: [
        `${PUBLISHER.name} fournit au Client les informations utiles pour mener une analyse d'impact relative à la protection des données ou consulter l'autorité de contrôle, en particulier sur la rédaction de brouillons par l'IA.`,
      ],
    },
    {
      id: "fin-du-contrat",
      title: "Fin du contrat : restitution et suppression",
      body: [
        `Avant la fin du contrat, le Client récupère ses données : export des rapports en Word ou en PDF et téléchargement des livrables depuis l'application. ${PUBLISHER.name} peut l'aider sur demande.`,
        `Sur demande écrite d'un propriétaire, ${PUBLISHER.name} supprime les espaces du Client avec leur contenu et leurs fichiers dans un délai de 30 jours, et le confirme par écrit.`,
        `Sans demande, les espaces restent en lecture seule (voir les [conditions générales de vente](/cgv#fin-de-periode)). ${PUBLISHER.name} peut alors les supprimer après avoir prévenu les propriétaires par e-mail au moins 30 jours avant.`,
        "Les copies de sauvegarde disparaissent à leur expiration : 14 jours pour la base de données, environ 32 jours pour les fichiers. Elles ne servent qu'à une restauration après incident. Après une restauration, les suppressions demandées sont appliquées à nouveau.",
        `${PUBLISHER.name} ne garde que les données qu'une loi l'oblige à conserver.`,
        "Les comptes des membres ne sont pas supprimés avec les espaces : chaque personne décide de son propre compte.",
      ],
    },
    {
      id: "audits",
      title: "Information et audits",
      body: [
        `${PUBLISHER.name} met à la disposition du Client les informations nécessaires pour démontrer le respect du présent Accord : description des mesures de sécurité, liste des sous-traitants, réponses aux questionnaires de sécurité raisonnables.`,
        "Le Client peut faire réaliser un audit une fois par an, à ses frais, par un auditeur indépendant tenu au secret, avec un préavis écrit de 30 jours. L'audit ne doit pas perturber le service ni donner accès aux données des autres clients. Un audit supplémentaire est possible après une violation de données ou à la demande d'une autorité.",
        `Pour toute demande, écrivez à ${SUPPORT_EMAIL}.`,
      ],
    },
    {
      id: "obligations-client",
      title: "Obligations du Client",
      body: [
        "Le Client s'engage à :",
        {
          list: [
            "disposer d'une base légale pour les données qu'il dépose et informer les personnes concernées ;",
            "ne déposer que les données nécessaires à ses rapports et éviter les données sensibles inutiles, sachant que le masquage avant l'envoi à l'IA ne couvre ni les noms, ni les adresses postales, ni les informations de santé ;",
            "gérer les accès de ses membres et retirer ceux qui ne doivent plus en avoir ;",
            "donner des instructions conformes à la loi.",
          ],
        },
      ],
    },
    {
      id: "responsabilite",
      title: "Responsabilité",
      body: [
        "Chaque partie répond des dommages causés par son propre manquement au présent Accord, dans les limites prévues par les [conditions générales de vente](/cgv#responsabilite), sauf lorsque la loi les écarte.",
      ],
    },
    {
      id: "duree-et-droit-applicable",
      title: "Durée et droit applicable",
      body: [
        "Le présent Accord s'applique pendant toute la durée du contrat et jusqu'à la suppression des données du Client.",
        "En cas de contradiction avec les CGU ou les CGV sur la protection des données, le présent Accord prime.",
        "Il est régi par le droit de la République du Bénin. Les litiges sont portés devant les juridictions compétentes de Cotonou.",
      ],
    },
  ],
};
