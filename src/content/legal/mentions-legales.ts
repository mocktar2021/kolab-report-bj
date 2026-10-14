import { GROUP_COMPANY, PUBLISHER, SUPPORT_EMAIL } from "./publisher";
import type { LegalDocument } from "./types";

export const mentionsLegales: LegalDocument = {
  updatedAt: "2026-10-14",
  intro: [
    "Cette page présente l'éditeur du site et de l'application KolabReport, le directeur de la publication, l'hébergement et les règles de propriété intellectuelle.",
  ],
  sections: [
    {
      id: "editeur",
      title: "Éditeur",
      body: [
        `KolabReport est édité et vendu par ${PUBLISHER.name}.`,
        {
          facts: [
            ["Dénomination", PUBLISHER.name],
            ["Forme", PUBLISHER.legalForm],
            ["Siège", PUBLISHER.address],
            ["RCCM", PUBLISHER.rccm],
            ["IFU", PUBLISHER.ifu],
            ["Numéro employeur CNSS", PUBLISHER.cnss],
            ["E-mail", SUPPORT_EMAIL],
            ["Site du groupe", `[mocktar.com](${PUBLISHER.website})`],
          ],
        },
      ],
    },
    {
      id: "directeur-publication",
      title: "Directeur de la publication",
      body: [`Le directeur de la publication est ${PUBLISHER.director}.`],
    },
    {
      id: "contact",
      title: "Contact",
      body: [
        `Pour toute question sur KolabReport, écrivez à ${SUPPORT_EMAIL}.`,
        "Pour une demande sur vos données personnelles, utilisez la même adresse. La [politique de confidentialité](/confidentialite#exercer-vos-droits) explique comment nous la traitons.",
      ],
    },
    {
      id: "hebergement",
      title: "Hébergement",
      body: [
        "Le site et l'application sont hébergés par :",
        {
          list: [
            "**Vercel Inc.** ([vercel.com](https://vercel.com)) pour l'application. Les fonctions du serveur s'exécutent dans la région de Paris (France). Les requêtes passent d'abord par le réseau mondial de Vercel.",
            "**Supabase Inc.** ([supabase.com](https://supabase.com)) pour la base de données, l'authentification et le stockage des fichiers, dans la région Europe de l'Ouest (Paris, France).",
          ],
        },
        "Les autres prestataires qui traitent des données pour KolabReport sont listés dans la [politique de confidentialité](/confidentialite#sous-traitants).",
      ],
    },
    {
      id: "groupe",
      title: "Groupe Mocktar Technologies",
      body: [
        `${GROUP_COMPANY.name}, société de l'État de Caroline du Nord (États-Unis), ${GROUP_COMPANY.address}, appartient au même groupe. Elle apporte un appui à l'ingénierie et aux activités du groupe aux États-Unis.`,
        `${GROUP_COMPANY.name} n'est pas le vendeur de KolabReport pour les clients facturés en FCFA. Ce vendeur est ${PUBLISHER.name}, au Bénin.`,
        `La liste des entités du groupe est publiée sur [mocktar.com](${PUBLISHER.entitiesPage}).`,
      ],
    },
    {
      id: "propriete-intellectuelle",
      title: "Propriété intellectuelle",
      body: [
        `Le site, l'application, leur code, leurs textes, leurs illustrations, le nom KolabReport et son logo appartiennent à ${PUBLISHER.name} ou sont utilisés avec l'accord de leurs titulaires. Toute reproduction, représentation ou adaptation, totale ou partielle, sans autorisation écrite de ${PUBLISHER.name} est interdite.`,
        "Les logiciels libres et les polices de caractères intégrés à KolabReport restent soumis à leur propre licence.",
        `Les contenus déposés dans KolabReport (rapports, livrables, modèles de prompts) restent la propriété de l'organisation cliente ou de leurs auteurs. Les [conditions générales d'utilisation](/cgu#contenus) précisent la licence accordée à ${PUBLISHER.name} pour faire fonctionner le service.`,
      ],
    },
    {
      id: "donnees-personnelles",
      title: "Données personnelles et cookies",
      body: [
        "Le traitement de vos données et les cookies utilisés sont décrits dans la [politique de confidentialité](/confidentialite). KolabReport n'utilise ni cookie publicitaire ni outil de mesure d'audience.",
      ],
    },
    {
      id: "droit-applicable",
      title: "Droit applicable",
      body: ["Les présentes mentions sont régies par le droit de la République du Bénin."],
    },
  ],
};
