import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { OFFERS } from "@/lib/billing/catalog";
import { planLimitsTable } from "./plan-limits";
import type { GuidePart } from "./types";

// Part 3 of the guide: the short FAQ. The plan limits come from the
// catalogue (plan-limits.ts), the same figures as /fr/tarifs.

const pack = OFFERS.ai_pack_100;

export const faqPart: GuidePart = {
  id: "questions-frequentes",
  title: "Questions fréquentes",
  intro: [],
  sections: [
    {
      id: "mot-de-passe-oublie",
      title: "J'ai oublié mon mot de passe",
      body: [
        {
          steps: [
            "Sur la page [Connexion](/connexion), cliquez sur le lien **Mot de passe oublié ?**",
            "Saisissez votre **Adresse e-mail** et cliquez sur **Envoyer le lien**.",
            "Ouvrez l'e-mail reçu et cliquez sur le lien. Il reste valable une heure.",
            `Choisissez votre **Nouveau mot de passe** (${PASSWORD_MIN_LENGTH} caractères minimum, dont au moins une lettre et un chiffre), recopiez-le dans **Confirmez le mot de passe**, puis cliquez sur **Enregistrer le mot de passe**.`,
          ],
        },
        "Si la page affiche « Lien expiré », le lien a déjà servi ou a plus d'une heure : cliquez sur **Demander un nouveau lien**. Pas d'e-mail après quelques minutes ? Regardez dans les courriers indésirables.",
      ],
    },
    {
      id: "roles",
      title: "Quels sont les rôles ?",
      body: [
        "Chaque membre a un rôle dans chaque espace de travail. Une même personne peut être propriétaire d'un espace et experte dans un autre.",
        {
          table: {
            caption: "Rôles d'un espace de travail",
            head: ["Rôle", "Ce qu'il peut faire"],
            rows: [
              [
                "Propriétaire",
                "Tout ce que fait un administrateur, plus : nommer d'autres propriétaires, finaliser un rapport ou le rouvrir, ouvrir les paramètres de l'espace et payer l'abonnement.",
              ],
              [
                "Administrateur",
                "Inviter et gérer les administrateurs, les experts et les lecteurs. Créer les rapports, les sections et les modèles de prompts, attribuer les sections, soumettre un rapport pour revue et l'exporter.",
              ],
              [
                "Expert",
                "Lire tous les rapports de l'espace. Dans ses sections : déposer des livrables, demander des brouillons à l'IA, écrire le texte et changer le statut.",
              ],
              [
                "Lecteur",
                "Lire les rapports sans rien modifier. Les lecteurs sont gratuits sur toutes les offres.",
              ],
            ],
          },
        },
        "Un propriétaire ou un administrateur peut aussi rédiger une section. Un espace de travail garde toujours au moins un propriétaire. Le rôle se change sur la page **Gérer les membres**.",
      ],
    },
    {
      id: "donnees-et-confidentialite",
      title: "Où sont mes données et qui peut les voir ?",
      body: [
        {
          list: [
            "Les données de KolabReport sont hébergées dans l'Union européenne, dans la région de Paris.",
            "Chaque espace de travail est isolé : seuls ses membres voient ses rapports, ses sections et ses fichiers, selon leur rôle.",
            "Les fichiers déposés sont stockés dans un espace privé. Ils s'ouvrent par des liens valables 60 secondes, après un contrôle d'accès.",
            "Avant tout envoi à l'IA, les adresses e-mail, les numéros de téléphone du Bénin et de France, les IBAN, les numéros de sécurité sociale français et les numéros de carte bancaire sont remplacés par un repère. Les noms de personnes ne sont pas masqués : ne déposez pas de données sensibles dont le rapport n'a pas besoin.",
            "Dans **Mon compte**, **Télécharger mes données** vous donne un fichier avec ce que KolabReport garde sur vous.",
          ],
        },
        "Le détail est dans la [politique de confidentialité](/confidentialite) et, pour les organisations clientes, dans l'[accord de traitement des données](/accord-traitement-donnees).",
      ],
    },
    {
      id: "ce-que-fait-l-ia",
      title: "Que fait l'IA, et que ne fait-elle pas ?",
      body: [
        "L'IA rédige des propositions :",
        {
          list: [
            "le brouillon d'une section, à partir de son titre, de ses consignes et du texte de ses livrables analysés, en suivant le modèle de prompt choisi ;",
            "le plan d'un rapport, à partir d'un PDF, dans **Importer le plan** ;",
            "le texte d'un modèle de prompt, à partir de votre description, avec **Rédiger avec l'IA**.",
          ],
        },
        "Ce qu'elle ne fait pas :",
        {
          list: [
            "Elle ne change jamais une section toute seule. Un brouillon n'entre dans la section que si un membre l'accepte, tel quel ou corrigé.",
            "Elle ne lit pas les PDF, les présentations, les images ni les schémas déposés comme livrables.",
            "Elle ne reçoit ni le nom ni l'adresse e-mail de la personne qui fait la demande.",
            "Elle ne vérifie pas les faits. Un brouillon peut contenir des erreurs, des oublis ou des chiffres mal lus : relisez-le et vérifiez les chiffres et les sources avant de l'accepter.",
            "KolabReport n'utilise pas vos contenus pour entraîner des modèles d'IA.",
          ],
        },
        "Plus de détails dans les [conditions d'utilisation](/cgu#brouillons-ia) et la [politique de confidentialité](/confidentialite#intelligence-artificielle).",
      ],
    },
    {
      id: "limites-des-offres",
      title: "Quelles sont les limites de chaque offre ?",
      body: [
        "Les limites portent sur l'organisation, pour tous ses espaces de travail, sauf ceux couverts par un Pass Mission, qui ont leurs propres limites.",
        planLimitsTable(),
        {
          list: [
            "**Membres** : les propriétaires, administrateurs et experts, invitations en attente comprises. Une même personne compte une fois. Les lecteurs sont gratuits et illimités.",
            "**Rapports actifs** : les rapports en brouillon ou en revue. Un rapport final ne compte plus.",
            "**Brouillons IA** : comptés quand ils aboutissent, pour toute l'organisation. La lecture d'un plan en PDF en compte un. Le compteur du mois repart à zéro le 1er de chaque mois.",
            `**Pack IA** : ${pack.drafts} brouillons IA de plus, valables ${pack.validMonths} mois, utilisés quand le quota de l'offre est épuisé. ${pack.maxQuantity} packs au plus en même temps, avec une offre payante ou un Pass Mission.`,
          ],
        },
        "Les prix et le détail des offres sont sur la page [Tarifs](/tarifs).",
      ],
    },
  ],
};
