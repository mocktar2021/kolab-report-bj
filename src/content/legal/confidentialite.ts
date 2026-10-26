import { PUBLISHER, SUPPORT_EMAIL } from "./publisher";
import type { LegalDocument } from "./types";

// Facts come from docs/gdpr (record of processing, processors, retention,
// data subject requests). Update both together: docs/legal.md says how.

const CONTROLLER = "Responsable de traitement";
const PROCESSOR = "Sous-traitant de l'organisation cliente";

export const confidentialite: LegalDocument = {
  updatedAt: "2026-10-26",
  intro: [
    "Cette politique explique quelles données personnelles KolabReport traite, pourquoi, avec qui elles sont partagées, combien de temps elles sont gardées et comment exercer vos droits. Elle s'applique au site, à l'application KolabReport et aux e-mails qu'ils envoient.",
  ],
  sections: [
    {
      id: "responsable",
      title: "Qui est responsable de vos données",
      body: [
        `KolabReport est édité par ${PUBLISHER.name}, établissement immatriculé en République du Bénin (RCCM ${PUBLISHER.rccm}), dont le siège est situé ${PUBLISHER.address}. Les autres informations sur l'éditeur figurent dans les [mentions légales](/mentions-legales).`,
        `Pour toute question sur vos données, écrivez à ${SUPPORT_EMAIL}.`,
        "Au Bénin, le traitement des données personnelles est encadré par la loi n° 2017-20 du 20 avril 2018 portant code du numérique en République du Bénin. Lorsque vous êtes dans l'Union européenne, le règlement général sur la protection des données (RGPD) peut aussi s'appliquer.",
      ],
    },
    {
      id: "roles",
      title: "Deux rôles selon les données",
      body: [
        `${PUBLISHER.name} n'a pas le même rôle pour toutes les données.`,
        {
          table: {
            caption: `Rôle de ${PUBLISHER.name} selon les données`,
            head: ["Données", `Rôle de ${PUBLISHER.name}`, "Qui décide"],
            rows: [
              [
                "Votre compte : e-mail, nom, mot de passe, sessions, historique de connexion",
                CONTROLLER,
                PUBLISHER.name,
              ],
              ["Facturation : offre, paiements, factures et reçus", CONTROLLER, PUBLISHER.name],
              [
                "Sécurité du service, limites d'usage de l'IA, mesure du coût et de la qualité des brouillons",
                CONTROLLER,
                PUBLISHER.name,
              ],
              [
                "Contenu des espaces de travail : rapports, sections, livrables, brouillons IA, exports, modèles de prompts, notifications",
                PROCESSOR,
                "L'organisation cliente, par exemple le cabinet",
              ],
              ["Membres des espaces, rôles et invitations", PROCESSOR, "L'organisation cliente"],
              ["Rappel de lancement : l'adresse e-mail laissée sur le site", CONTROLLER, PUBLISHER.name],
            ],
          },
        },
        "Pour le contenu, l'organisation cliente décide de ce qui est déposé, de qui y accède et pendant combien de temps. Si vous êtes cité dans un rapport ou un livrable, adressez-vous d'abord à l'organisation concernée.",
        "Nos engagements de sous-traitant figurent dans l'[accord de traitement des données](/accord-traitement-donnees).",
      ],
    },
    {
      id: "donnees-traitees",
      title: "Données que nous traitons",
      body: [
        {
          list: [
            "**Compte** : adresse e-mail, nom complet, mot de passe (enregistré sous forme d'empreinte, jamais en clair), date de confirmation de l'adresse, date de dernière connexion, langue.",
            "**Sessions et sécurité** : adresse IP, navigateur et système, dates de début et de renouvellement de la session, journal des connexions et des inscriptions (identifiant, nom, e-mail, adresse IP).",
            "**Espaces de travail** : nom de l'organisation et des espaces, rôle de chaque membre, auteur et date des invitations, adresse e-mail des personnes invitées.",
            "**Contenu** : rapports, sections, livrables déposés et texte extrait de ces fichiers, brouillons proposés par l'IA, exports, historique des changements de statut, notifications. Ce contenu peut citer des personnes : clients de l'organisation, bénéficiaires, personnel d'une structure auditée.",
            "**Utilisation de l'IA** : auteur de la demande, modèle utilisé, nombre de jetons, coût estimé, durée, brouillon accepté ou non, note et commentaire laissés sur le brouillon.",
            "**Facturation** : organisation cliente, offre choisie, périodes payées, montants, factures et reçus, et le résultat de chaque paiement transmis par FedaPay (référence, montant, date, statut, moyen de paiement).",
            "**Échanges avec le support** : les messages que vous nous envoyez et nos réponses.",
            "**Rappel de lancement** : l'adresse e-mail que vous laissez sur le site avant l'ouverture des inscriptions, pour recevoir un e-mail à l'ouverture.",
            "**Journaux techniques** : requêtes reçues par les serveurs et erreurs de l'application.",
          ],
        },
        `Les numéros de carte et les codes mobile money sont saisis chez FedaPay : ${PUBLISHER.name} ne les reçoit pas.`,
        "Nous ne vendons pas vos données et nous ne les utilisons pas pour de la publicité. KolabReport s'adresse aux professionnels et n'est pas destiné aux mineurs.",
      ],
    },
    {
      id: "finalites",
      title: "Pourquoi nous les traitons",
      body: [
        {
          table: {
            caption: "Finalités et bases légales",
            head: ["Finalité", "Base légale"],
            rows: [
              [
                "Créer votre compte, confirmer votre adresse, vous connecter et garder votre session ouverte",
                "Exécution du contrat ([conditions générales d'utilisation](/cgu))",
              ],
              [
                "Fournir le service à votre organisation : espaces, invitations, rapports, livrables, exports, notifications",
                "Exécution du contrat avec l'organisation. Pour le contenu, nous agissons sur ses instructions.",
              ],
              [
                "Proposer un brouillon rédigé par l'IA quand un membre le demande",
                "Exécution du contrat, sur instruction de l'organisation",
              ],
              [
                "Envoyer les e-mails du service : confirmation d'adresse, mot de passe, invitations, changements de statut, rappels de renouvellement",
                "Exécution du contrat",
              ],
              [
                "Vendre les offres, encaisser les paiements, émettre les factures et les reçus",
                "Exécution du contrat ([conditions générales de vente](/cgv)) et obligations comptables et fiscales",
              ],
              [
                "Protéger le service : journaux de sécurité, limites d'usage de l'IA, budget mensuel, détection des abus et des erreurs",
                `Intérêt légitime de ${PUBLISHER.name} à assurer la sécurité et le bon fonctionnement du service`,
              ],
              [
                "Mesurer la qualité des brouillons IA (acceptation, modifications, notes) pour améliorer les modèles de prompts",
                "Intérêt légitime",
              ],
              ["Répondre à vos demandes au support", "Exécution du contrat ou intérêt légitime"],
              [
                "Vous écrire à l'ouverture des inscriptions, si vous avez laissé votre adresse sur le site avant le lancement",
                `Consentement. Vous le retirez à tout moment avec le lien de désinscription de l'e-mail ou en écrivant à ${SUPPORT_EMAIL}.`,
              ],
              [
                "Respecter nos obligations légales et défendre nos droits",
                "Obligation légale ou intérêt légitime",
              ],
            ],
          },
        },
      ],
    },
    {
      id: "destinataires",
      title: "Qui reçoit vos données",
      body: [
        {
          list: [
            "**Les membres de vos espaces de travail** voient votre nom, votre adresse e-mail et le contenu que leur rôle leur permet de lire.",
            `**Les personnes habilitées de ${PUBLISHER.name}** les traitent pour faire fonctionner le service, répondre au support et traiter les demandes sur les données. Elles n'accèdent au contenu des espaces que lorsque c'est nécessaire, par exemple sur demande écrite de l'organisation.`,
            "**Nos sous-traitants**, listés ci-dessous, reçoivent les données utiles à la tâche qui leur est confiée.",
            "**Les autorités** les reçoivent lorsque la loi nous y oblige.",
          ],
        },
      ],
    },
    {
      id: "sous-traitants",
      title: "Sous-traitants",
      body: [
        `${PUBLISHER.name} ne confie des données qu'à des prestataires qui s'engagent par contrat à les protéger, dans un accord de traitement des données. Certains services ne reçoivent des données que lorsqu'ils sont activés.`,
        {
          table: {
            caption: "Sous-traitants de KolabReport",
            head: ["Prestataire", "Utilisation", "Données reçues", "Localisation"],
            rows: [
              [
                "[Supabase](https://supabase.com) (Supabase Inc.)",
                "Base de données, authentification, stockage des fichiers, mises à jour en direct",
                "Toutes les données de l'application",
                "Union européenne, région de Paris. Supabase ou ses propres sous-traitants peuvent y accéder depuis d'autres pays.",
              ],
              [
                "[Vercel](https://vercel.com) (Vercel Inc.)",
                "Hébergement de l'application",
                "Requêtes, pages affichées, cookies de session, fichiers lus pendant leur analyse, demandes et réponses de l'IA en transit, journaux",
                "Fonctions dans la région de Paris, réseau d'acheminement mondial. Société établie aux États-Unis.",
              ],
              [
                "[Anthropic](https://www.anthropic.com)",
                "Rédaction des brouillons par l'IA, fournisseur principal",
                "Le contexte d'une section, après masquage (voir [Intelligence artificielle](#intelligence-artificielle))",
                "Société établie aux États-Unis",
              ],
              [
                "[OpenAI](https://openai.com)",
                "Rédaction des brouillons par l'IA, seulement s'il est activé comme fournisseur de secours",
                "Le même contexte qu'Anthropic",
                "Société établie aux États-Unis",
              ],
              [
                "[Resend](https://resend.com) ou [Brevo](https://www.brevo.com)",
                "Envoi des e-mails du service. Resend garde aussi la liste du rappel de lancement.",
                "Adresse du destinataire, objet et contenu de l'e-mail : noms, noms d'espace et de rapport, liens. Pour le rappel de lancement : l'adresse laissée sur le site.",
                "Resend : société établie aux États-Unis. Brevo : France et Belgique.",
              ],
              [
                "[FedaPay](https://www.fedapay.com)",
                "Paiement des offres par mobile money et par carte",
                "Données de paiement saisies chez FedaPay, montant et référence de la commande",
                "Voir les conditions de FedaPay",
              ],
              [
                "[Sentry](https://sentry.io)",
                "Suivi des erreurs de l'application, lorsqu'il est activé",
                "Erreurs, identifiant technique de l'utilisateur, page, navigateur. Ni nom, ni e-mail, ni adresse IP.",
                "Union européenne pour les erreurs. Société établie aux États-Unis.",
              ],
              [
                "[Langfuse](https://langfuse.com)",
                "Suivi technique des appels à l'IA, lorsqu'il est activé",
                "Identifiants techniques, modèle, jetons, durée et coût, sans le texte des demandes ni des brouillons",
                "Union européenne (Irlande)",
              ],
              [
                "[Cloudflare](https://www.cloudflare.com)",
                "Copie de sauvegarde des fichiers (R2), lorsqu'elle est activée. Vérification anti-robot (Turnstile) sur l'inscription, la connexion et la demande de nouveau mot de passe, lorsqu'elle est activée",
                "Copie des livrables et des exports. Pour Turnstile : adresse IP et signaux techniques du navigateur, sans cookie publicitaire",
                "Union européenne pour R2. Turnstile : réseau mondial de Cloudflare, société établie aux États-Unis",
              ],
              [
                "[GitHub](https://github.com)",
                "Exécution des sauvegardes nocturnes, lorsqu'elles sont activées",
                "Copie de la base de données pendant la sauvegarde, puis copie chiffrée gardée 14 jours",
                "Société établie aux États-Unis, lieu de traitement non choisi",
              ],
            ],
          },
        },
        "FedaPay traite aussi les données de paiement pour son propre compte, selon sa propre politique de confidentialité.",
        "Nous mettons cette liste à jour avant qu'un nouveau prestataire reçoive des données. Pour le contenu des espaces, l'organisation cliente est prévenue comme le prévoit l'[accord de traitement des données](/accord-traitement-donnees#sous-traitants-ulterieurs).",
      ],
    },
    {
      id: "transferts",
      title: "Transferts hors du Bénin et de l'Union européenne",
      body: [
        "Les données de KolabReport sont hébergées dans l'Union européenne, dans la région de Paris. Pour les utilisateurs situés au Bénin, cet hébergement est un transfert hors du Bénin.",
        "Plusieurs sous-traitants sont établis aux États-Unis. Eux-mêmes ou leurs propres sous-traitants peuvent accéder à certaines données depuis les États-Unis ou d'autres pays, par exemple pour le support ou pour traiter une demande à l'IA.",
        "Ces transferts sont encadrés par les garanties prévues par la loi applicable : clauses contractuelles types de la Commission européenne dans les accords de traitement des prestataires, certification du prestataire au Data Privacy Framework UE-États-Unis lorsqu'elle existe, et conditions de transfert fixées par le code du numérique pour les données venant du Bénin.",
        `Pour obtenir une copie de ces garanties, écrivez à ${SUPPORT_EMAIL}.`,
      ],
    },
    {
      id: "conservation",
      title: "Durées de conservation",
      body: [
        {
          table: {
            caption: "Durées de conservation",
            head: ["Données", "Durée"],
            rows: [
              [
                "Compte et profil",
                "Tant que le compte existe. Vous pouvez le supprimer vous-même à tout moment (voir [Exercer vos droits](#exercer-vos-droits)).",
              ],
              [
                "Session de connexion",
                "Le jeton d'accès vaut une heure et se renouvelle tant que vous restez connecté. La déconnexion met fin à la session dans ce navigateur.",
              ],
              [
                "Journal des connexions",
                "Le temps nécessaire à la sécurité du service et à l'analyse d'un incident.",
              ],
              [
                "Membres et invitations",
                "Un membre reste inscrit jusqu'à son départ, son retrait ou la suppression de l'espace. Un lien d'invitation vaut 7 jours et ne sert qu'une fois. L'invitation reste enregistrée tant que l'espace existe.",
              ],
              [
                "Rapports, sections, livrables, brouillons IA, historique des statuts, notifications",
                "Tant que l'organisation les garde. Depuis l'application, les propriétaires et administrateurs suppriment un rapport, les propriétaires un espace de travail, et le propriétaire de l'organisation l'organisation entière. Au plus tard, jusqu'à la suppression de l'espace de travail à la fin du contrat (voir l'[accord de traitement des données](/accord-traitement-donnees#fin-du-contrat)). Quand une section disparaît, seule ou avec son rapport, le texte de ses brouillons IA est effacé : il ne reste que l'usage (jetons, coût, dates), pour les limites et la facturation.",
              ],
              [
                "Exports de rapports",
                "90 jours pour un export fait à la demande. Le PDF créé quand un rapport devient final est gardé aussi longtemps que le rapport.",
              ],
              ["Fichiers supprimés", "Retirés du stockage par une tâche quotidienne."],
              [
                "Journal des suppressions et des transferts : qui a supprimé un rapport, un espace de travail ou une organisation, ou transféré une organisation, et quand",
                "12 mois, puis il est effacé. Il ne garde ni titre, ni nom, ni contenu.",
              ],
              [
                "Essai gratuit",
                "Une empreinte de l'adresse e-mail de la personne qui a ouvert l'essai, sans l'adresse elle-même, pour qu'une même personne n'ait qu'un essai gratuit. Elle est gardée sans limite de durée, même après la suppression du compte.",
              ],
              [
                "Facturation : factures, reçus, paiements",
                "La durée imposée par les obligations comptables et fiscales applicables.",
              ],
              [
                "Échanges avec le support",
                "Le temps de traiter la demande, puis le temps utile en cas de contestation.",
              ],
              [
                "Rappel de lancement",
                "Jusqu'à l'e-mail d'ouverture, puis 30 jours au plus. Vous pouvez demander l'effacement avant.",
              ],
              [
                "Journaux techniques et erreurs",
                "La durée fixée par chaque prestataire. Pour Sentry, 30 à 90 jours selon l'offre.",
              ],
              [
                "Sauvegardes",
                "La copie chiffrée de la base de données est gardée 14 jours. Un fichier supprimé disparaît de toutes les copies dans un délai d'environ 32 jours.",
              ],
            ],
          },
        },
      ],
    },
    {
      id: "securite",
      title: "Sécurité",
      body: [
        `${PUBLISHER.name} prend des mesures techniques et organisationnelles adaptées aux risques. Les principales :`,
        {
          list: [
            "Chaque table de la base de données isole les données par espace de travail et par rôle (sécurité au niveau des lignes).",
            "Les fichiers sont stockés dans un espace privé. Ils s'ouvrent par des liens signés valables 60 secondes, après un contrôle d'accès.",
            "Les mots de passe sont enregistrés sous forme d'empreinte. L'adresse e-mail est confirmée avant la première connexion.",
            "Les connexions sont chiffrées (HTTPS) et les clés d'accès restent sur le serveur.",
            "Les données personnelles repérables sont masquées avant tout envoi à l'IA.",
            "La base de données est sauvegardée chaque nuit, sous forme chiffrée.",
          ],
        },
        "Aucune mesure ne supprime tout risque. En cas de violation de données qui présente un risque pour vous, nous prévenons l'autorité compétente et, lorsque la loi le prévoit, les personnes concernées.",
      ],
    },
    {
      id: "vos-droits",
      title: "Vos droits",
      body: [
        "Selon la loi applicable, vous pouvez :",
        {
          list: [
            "accéder à vos données et en obtenir une copie ;",
            "les faire corriger si elles sont inexactes ou incomplètes ;",
            "les faire supprimer ;",
            "vous opposer à un traitement fondé sur notre intérêt légitime ;",
            "demander la limitation d'un traitement ;",
            "recevoir les données que vous nous avez fournies dans un format lisible par une machine, lorsque le RGPD s'applique.",
          ],
        },
        "Certaines demandes peuvent être refusées ou limitées lorsque la loi nous oblige à garder les données, par exemple les factures.",
      ],
    },
    {
      id: "exercer-vos-droits",
      title: "Exercer vos droits",
      body: [
        `Écrivez à ${SUPPORT_EMAIL} depuis l'adresse e-mail de votre compte. Si vous écrivez depuis une autre adresse, nous vous demandons de confirmer votre identité.`,
        "Nous répondons dans un délai d'un mois. Pour une demande complexe, ce délai peut être prolongé de deux mois : nous vous prévenons alors dans le premier mois.",
        "Depuis la page **Mon compte** de l'application, vous pouvez vous-même télécharger vos données dans un fichier JSON, corriger votre nom et supprimer votre compte. Le texte des rapports n'est pas dans ce fichier : les propriétaires et administrateurs d'un espace peuvent exporter chaque rapport en Word ou en PDF.",
        "Si vous êtes propriétaire d'une organisation, ou le seul propriétaire d'un espace de travail, transférez-les ou supprimez-les avant de supprimer votre compte. Cette page indique quoi faire. Les rapports et fichiers que vous avez créés restent dans leurs espaces de travail, sans votre nom, et les paiements et reçus restent rattachés à l'organisation. Pour qu'une même personne n'ait qu'un essai gratuit, nous gardons une empreinte de votre adresse e-mail, sans l'adresse elle-même et sans limite de durée.",
        "Si votre demande porte sur le contenu d'un rapport ou d'un livrable, elle relève de l'organisation qui l'a déposé. Nous la lui transmettons et l'aidons à y répondre.",
      ],
    },
    {
      id: "reclamation",
      title: "Réclamation",
      body: [
        "Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir l'Autorité de Protection des Données Personnelles (APDP) du Bénin : [apdp.bj](https://apdp.bj).",
        "Si vous résidez dans l'Union européenne, vous pouvez aussi saisir l'autorité de protection des données de votre pays, par exemple la CNIL en France.",
        `Vous pouvez aussi nous écrire d'abord à ${SUPPORT_EMAIL} : la plupart des questions se règlent vite.`,
      ],
    },
    {
      id: "cookies",
      title: "Cookies et stockage local",
      body: [
        "KolabReport utilise uniquement les cookies et le stockage local nécessaires au service. Il n'y a ni cookie publicitaire, ni mesure d'audience, ni bouton de réseau social. Ces éléments ne demandent donc pas votre consentement préalable.",
        {
          table: {
            caption: "Cookies et stockage local utilisés par KolabReport",
            head: ["Nom", "Type", "Rôle", "Durée"],
            rows: [
              [
                "`sb-…-auth-token`",
                "Cookie",
                "Garde votre session de connexion (Supabase)",
                "Jusqu'à la déconnexion ou la fin de la session",
              ],
              ["`kr-espace`", "Cookie", "Retient l'espace de travail en cours", "1 an"],
              [
                "`kolabreport:theme`",
                "Stockage local",
                "Retient le thème choisi : clair, sombre ou système",
                "Jusqu'à ce que vous l'effaciez",
              ],
              [
                "`kolabreport:sidebar`",
                "Stockage local",
                "Retient si le menu latéral est réduit",
                "Jusqu'à ce que vous l'effaciez",
              ],
              [
                "Caches de l'application",
                "Stockage du navigateur",
                "Permet de relire hors ligne les pages déjà consultées",
                "Les pages sont effacées à la déconnexion",
              ],
            ],
          },
        },
        "Les polices de caractères sont servies par KolabReport lui-même : votre navigateur ne contacte pas Google.",
        "Lorsque la vérification anti-robot est activée, les formulaires d'inscription, de connexion et de demande de nouveau mot de passe chargent Cloudflare Turnstile. Turnstile lit des signaux techniques du navigateur pour distinguer une personne d'un robot. Il sert à la sécurité du service, ne sert pas à la publicité et ne demande donc pas de consentement.",
        "Vous pouvez effacer ces éléments dans les réglages de votre navigateur. Sans le cookie de session, vous ne pouvez pas rester connecté.",
      ],
    },
    {
      id: "intelligence-artificielle",
      title: "Intelligence artificielle",
      body: [
        "Quand un membre demande un brouillon de section, KolabReport envoie au fournisseur d'IA :",
        {
          list: [
            "le titre et les consignes de la section ;",
            "le titre et la description du rapport, et le nom de l'espace de travail ;",
            "le texte extrait des livrables de la section au format Word, Excel, CSV, texte, Markdown ou PDF, avec le nom de chaque fichier.",
          ],
        },
        "Les présentations PowerPoint, les images et les schémas ne sont pas lus : ils ne sont jamais envoyés, pas plus que les PDF sans texte lisible ou protégés par un mot de passe. Chaque fichier est envoyé en entier : rien n'est coupé ni résumé, et une section dont les fichiers dépassent ce que l'IA lit en une fois n'est pas envoyée. KolabReport n'envoie ni l'identifiant, ni le nom, ni l'e-mail de la personne qui fait la demande.",
        "Avant l'envoi, KolabReport remplace par un repère les adresses e-mail, les numéros de téléphone du Bénin et de France, les IBAN, les numéros de sécurité sociale français et les numéros de carte bancaire. Les noms de personnes, les adresses postales, les dates de naissance, les autres numéros d'identification et les informations de santé écrites en clair ne sont pas masqués. Évitez de déposer des données sensibles qui ne sont pas nécessaires au rapport.",
        `Le fournisseur d'IA traite ces données comme sous-traitant, pour produire le brouillon. La durée pendant laquelle il garde les demandes et l'usage qu'il peut en faire sont fixés par ses conditions commerciales et son accord de traitement des données. ${PUBLISHER.name} n'utilise pas vos contenus pour entraîner des modèles d'IA.`,
        "Le brouillon est enregistré comme une proposition. Il ne remplace le contenu de la section que si un membre l'accepte. Aucune décision produisant des effets juridiques à votre égard n'est prise de façon automatisée.",
        "Les demandes de brouillons sont limitées par personne et par heure, et par espace et par mois, pour éviter les abus et maîtriser les coûts.",
      ],
    },
    {
      id: "modifications",
      title: "Modifications de cette politique",
      body: [
        "Nous mettons cette page à jour quand nos traitements changent, et nous changeons la date en haut de la page. Pour un changement important, nous prévenons les utilisateurs par e-mail ou dans l'application avant qu'il s'applique.",
      ],
    },
  ],
};
