import { GRACE_DAYS, TRIAL } from "@/lib/billing/catalog";
import type { GuidePart } from "./types";

// Part 1 of the guide: what owners and admins do. Every label in bold is the
// exact text of the button, link or field in messages/fr.json.

export const ownerPart: GuidePart = {
  id: "proprietaire-et-administrateur",
  title: "Propriétaire et administrateur",
  intro: [
    "Les propriétaires et les administrateurs préparent le travail : ils créent les espaces de travail, invitent l'équipe, découpent le rapport en sections et les attribuent aux experts. Ils voient aussi l'abonnement de l'organisation.",
    "Les deux rôles ont presque les mêmes droits. Seul un propriétaire nomme d'autres propriétaires, finalise un rapport ou le rouvre. Un administrateur ne gère pas les propriétaires.",
  ],
  sections: [
    {
      id: "organisation-et-espaces",
      title: "Organisation et espaces de travail",
      body: [
        "L'**organisation** est votre cabinet ou votre entreprise. Elle regroupe vos espaces de travail et porte l'abonnement. Un **espace de travail** correspond à un client ou à une mission : ses membres ne voient que ses rapports.",
        "Pour commencer :",
        {
          steps: [
            "Créez votre compte sur la page [Créer un compte](/inscription), puis ouvrez le lien de confirmation reçu par e-mail.",
            "Au premier accès, le tableau de bord affiche « Créez votre premier espace de travail ». Cliquez sur **Créer un espace de travail**.",
            "L'assistant compte trois étapes : le nom de votre organisation (cabinet), le nom de l'espace de travail, puis le titre du premier rapport. Passez d'une étape à l'autre avec **Suivant**.",
            "Cliquez sur **Créer l'espace de travail**. Vous devenez propriétaire de l'organisation et de l'espace.",
          ],
        },
        `Une nouvelle organisation commence par un essai gratuit de ${TRIAL.days} jours, sans carte bancaire.`,
        "Pour une autre mission, ouvrez le sélecteur d'espace en haut du menu et choisissez **Nouvel espace de travail**. La première étape propose les organisations que vous gérez, ou **Nouvelle organisation** pour un autre cabinet.",
        {
          figure: "nouvelEspace",
          caption: "L'assistant de création d'un espace de travail, à l'étape de l'organisation.",
        },
        "Le même sélecteur mène aux autres pages de l'espace. **Paramètres de l'espace** est réservé à ses propriétaires. **Gérer l'organisation** est réservé au propriétaire de l'organisation : la page liste ses espaces de travail, permet d'en ajouter et de les supprimer. Pour confier l'organisation à quelqu'un d'autre, ouvrez **Mon compte**, puis **Transférer une organisation**.",
        "Le sélecteur range vos espaces par organisation. Quand vous en avez beaucoup, choisissez **Rechercher un espace**, tapez le nom d'un espace ou de son organisation, puis validez avec Entrée. Depuis n'importe quelle page, Ctrl+K (Cmd+K sur Mac) retrouve aussi un espace.",
      ],
    },
    {
      id: "invitations",
      title: "Inviter les membres",
      body: [
        "Ouvrez **Gérer les membres** depuis le tableau de bord, la page d'un rapport ou le sélecteur d'espace.",
        {
          steps: [
            "Sous **Inviter un membre**, saisissez l'**Adresse e-mail** de la personne et choisissez son **Rôle** : administrateur, expert ou lecteur. Seul un propriétaire peut inviter un autre propriétaire.",
            "Cliquez sur **Envoyer l'invitation**. La personne reçoit un e-mail avec un lien valable 7 jours, qui ne sert qu'une fois.",
            "Elle clique sur **Rejoindre l'espace**. Si elle n'a pas encore de compte, elle choisit **Créer mon compte** avec la même adresse et rejoint l'espace à sa première connexion.",
          ],
        },
        "Si l'e-mail n'a pas pu partir, la page affiche le lien de l'invitation. Copiez-le avec **Copier le lien** et envoyez-le vous-même.",
        "Les invitations qui n'ont pas encore servi sont listées sous **Invitations en attente**. **Renvoyer** envoie un nouveau lien, valable 7 jours, qui remplace l'ancien. **Annuler** retire l'invitation.",
        {
          figure: "membres",
          caption: "La page des membres, juste après l'envoi d'une invitation.",
        },
        "Dans la liste des membres, choisissez un autre rôle puis cliquez sur **Enregistrer**, ou retirez une personne avec **Retirer**. Ses sections redeviennent non attribuées. Un espace de travail garde toujours au moins un propriétaire.",
        "Les propriétaires, les administrateurs et les experts comptent dans la limite de membres de votre offre, invitations en attente comprises. Les lecteurs sont gratuits et ne comptent pas (voir [les limites de chaque offre](#limites-des-offres)).",
      ],
    },
    {
      id: "creer-un-rapport",
      title: "Créer un rapport",
      body: [
        {
          steps: [
            "Sur le **Tableau de bord**, cliquez sur **Nouveau rapport**.",
            "Saisissez le **Titre du rapport**, par exemple « Rapport de fin de mission ».",
            "Cliquez sur **Créer le rapport**. Le rapport s'ouvre, encore sans section.",
          ],
        },
        {
          figure: "nouveauRapport",
          caption: "La fenêtre « Nouveau rapport » sur le tableau de bord.",
        },
        "Un nouveau rapport est un **Brouillon**. Il compte parmi les rapports actifs de votre offre tant qu'il est en brouillon ou en revue. Un rapport final ne compte plus.",
        "Pour changer le titre plus tard, cliquez sur **Renommer** à côté du titre, en haut de la page du rapport, puis sur **Enregistrer**. Un rapport final ne se renomme pas.",
        "Ajoutez ensuite ses sections une à une, ou importez le plan que vous avez déjà.",
      ],
    },
    {
      id: "importer-le-plan",
      title: "Importer le plan",
      body: [
        "Vous avez déjà le plan du rapport, par exemple dans les termes de référence ? Importez-le pour créer toutes les sections d'un coup.",
        {
          steps: [
            "Sur la page du rapport, sous le formulaire d'ajout de section, cliquez sur **Importer le plan**.",
            "Sous **Depuis un fichier**, choisissez un fichier Word (.docx), texte (.txt), Markdown (.md) ou PDF de 4 Mo au plus, puis cliquez sur **Lire le fichier**. Vous pouvez aussi coller le plan sous **Ou collez le texte**, puis cliquer sur **Lire le texte**.",
            "Relisez la liste **Vérifiez le plan**. Renommez, retirez, fusionnez ou déplacez les éléments, et choisissez pour chacun **Section** ou **Sous-section**. Le texte écrit sous un titre devient ses consignes pour l'IA, que vous pouvez modifier.",
            "Cliquez sur le bouton en bas de la liste, par exemple **Créer les 12 sections**. Les sections s'ajoutent après celles que le rapport a déjà.",
          ],
        },
        {
          figure: "importerLePlan",
          caption: "Le plan lu à partir d'un texte collé, prêt à être relu.",
        },
        "Pour que le plan soit bien lu :",
        {
          list: [
            "dans Word, utilisez les styles **Titre 1** et **Titre 2** ;",
            "dans un texte, numérotez les titres (1., 1.1, I., A.) ou écrivez-les en Markdown (# et ##), un titre par ligne.",
          ],
        },
        "Un PDF est lu par l'IA, qui propose le plan : relisez chaque titre. Cette lecture compte comme un brouillon IA du mois. Un PDF scanné, sans texte, ne peut pas être lu : collez alors le texte du plan.",
        "Le fichier sert seulement à lire le plan, il n'est pas conservé. Rien n'est créé avant votre clic sur le bouton de création. Un import reprend 200 titres au plus.",
      ],
    },
    {
      id: "sections-et-sous-sections",
      title: "Sections et sous-sections",
      body: [
        "Pour ajouter une section à la main, allez sur la page du rapport :",
        {
          steps: [
            "Sous **Nouvelle section**, saisissez le titre.",
            "Dans **Emplacement**, gardez **À la fin du rapport** pour une section, ou choisissez **Sous-section de** suivi d'une section pour la placer dessous.",
            "Cliquez sur **Ajouter**.",
          ],
        },
        "Les sections sont numérotées 1, 2, 3 et leurs sous-sections 1.1, 1.2. Une sous-section ne peut pas avoir elle-même de sous-section.",
        "Pour changer l'ordre, faites glisser une section ou une sous-section par sa poignée. Une section emporte ses sous-sections. Au clavier : Espace pour la prendre, les flèches pour la déplacer, Espace pour la déposer.",
        "Ouvrez une section puis cliquez sur **Modifier le titre et les consignes**. Les **Consignes pour l'IA** disent ce que la section doit contenir, en 4 000 caractères au plus. Les brouillons de l'IA les suivent : plus elles sont précises, plus le brouillon est utile.",
        "En bas de la page d'une section, **Supprimer la section** l'efface avec ses sous-sections, son texte et ses fichiers. Une fenêtre liste ce qui sera supprimé avant de confirmer. Cette action est définitive.",
      ],
    },
    {
      id: "attribuer-les-sections",
      title: "Attribuer les sections aux experts",
      body: [
        "Sur la page du rapport, le **Sommaire** liste les sections. Pour chacune :",
        {
          steps: [
            "choisissez l'expert dans la liste, ou **Non attribuée** ;",
            "réglez son **Poids** si besoin : une section de poids 2 compte double dans l'avancement du rapport ;",
            "cliquez sur **Enregistrer** sur la ligne de la section.",
          ],
        },
        {
          figure: "rapportSections",
          caption: "Le sommaire d'un rapport, avec l'expert et le poids de chaque section.",
        },
        "Vous pouvez attribuer une section à un propriétaire, un administrateur ou un expert de l'espace, jamais à un lecteur. Une personne qui quitte l'espace ou devient lectrice perd ses sections, qui redeviennent non attribuées.",
        "L'expert retrouve ses sections sur le tableau de bord, et sur la page du rapport avec la mention **Votre section**. Il lit tout le rapport mais ne modifie que ses sections.",
        "Le **Tableau de bord** suit le travail : le nombre de sections par statut, l'avancement global, l'avancement de chaque rapport et la liste des sections avec leur expert. Sous chaque rapport, **Par expert** détaille l'avancement de chacun. Les filtres **Non commencées**, **En cours** et **Terminées** n'affichent que les sections d'un statut.",
        {
          figure: "tableauDeBord",
          caption: "Le tableau de bord d'une propriétaire.",
        },
      ],
    },
    {
      id: "modeles-ia",
      title: "Modèles de prompts pour l'IA",
      body: [
        "Un modèle de prompt contient les consignes que l'IA suit pour rédiger le brouillon d'une section : le ton, la structure, la longueur. KolabReport fournit des modèles globaux, prêts à servir et en lecture seule. Ouvrez **Modèles de prompts** dans le menu pour les voir avec ceux de votre espace.",
        "Pour créer un modèle propre à l'espace, cliquez sur **Nouveau modèle**. La page propose trois points de départ, de haut en bas :",
        {
          list: [
            "**Décrire ce que vous attendez** : cliquez sur **Décrire le modèle**. Vous n'écrivez pas les consignes de l'IA vous-même.",
            "**Copier un modèle KolabReport** : cliquez sur **Copier** à côté du modèle. La copie devient un modèle de votre espace, l'original ne change pas.",
            "**Copier un modèle de l'espace** : partez d'un modèle de l'espace, publié ou en brouillon.",
          ],
        },
        {
          figure: "nouveauModele",
          caption:
            "Les points de départ d'un nouveau modèle. La copie d'un modèle de l'espace est plus bas sur la page.",
        },
        "La page **Décrire le modèle** propose deux façons de faire :",
        {
          list: [
            "**Répondre à quelques questions** : le nom du modèle, le type de résultat, ce que la section doit contenir, la structure attendue, le ton, la longueur et ce qu'il faut faire quand une information manque. Cliquez sur **Créer le texte du modèle**. Le texte est construit à partir de vos réponses, sans IA.",
            "**Décrire en quelques phrases** : écrivez ce que vous attendez, puis cliquez sur **Rédiger avec l'IA**. L'IA rédige le texte du modèle. Ces essais ne comptent pas dans les brouillons IA du mois, mais leur nombre est limité par personne et par jour.",
          ],
        },
        {
          figure: "decrireModele",
          caption: "Une description en quelques phrases, avant « Rédiger avec l'IA ».",
        },
        "Dans tous les cas, l'éditeur s'ouvre sur le texte proposé. Relisez-le et corrigez-le : rien n'est enregistré avant que vous cliquiez sur **Publier** ou **Enregistrer en brouillon**. Les variables entre doubles accolades, comme `{{deliverables}}` ou `{{section_title}}`, sont remplacées par le contenu de la section au moment du brouillon. **Aperçu** montre le modèle rempli avec une section d'exemple.",
        "Les **Réglages avancés**, repliés par défaut, regroupent le modèle d'IA (Standard ou Rapide), la liberté de formulation et la longueur maximale du texte. Les valeurs par défaut conviennent dans la plupart des cas. Quand un réglage s'en écarte, la mention « Valeurs personnalisées » s'affiche.",
        {
          figure: "reglagesAvances",
          caption: "Les réglages avancés de l'éditeur, ouverts.",
        },
        "Cliquez sur **Publier** pour que le modèle serve aux brouillons, ou sur **Enregistrer en brouillon** pour le reprendre plus tard. Pour changer un modèle, ouvrez-le et cliquez sur **Nouvelle version** : les versions précédentes restent dans l'historique, et la page montre les changements depuis la précédente.",
        "Les modèles personnalisés sont inclus dans l'essai gratuit et dans les offres Cabinet et Institution. Avec l'offre Indépendant ou un Pass Mission, vous utilisez les modèles KolabReport.",
        "Le menu **Pilotage de l'IA**, réservé aux propriétaires et aux administrateurs, montre les brouillons de l'espace par version de modèle : volume, accueil des experts, coût et temps de réponse.",
      ],
    },
    {
      id: "rapport-final-et-exports",
      title: "Rapport final et exports",
      body: [
        "La page du rapport montre toutes les sections dans l'ordre, avec leur texte, sous **Texte du rapport**. C'est le rapport final en train de se construire. Le texte est replié : cliquez sur **Aperçu** pour l'afficher, ou sur le titre d'une section dans le **Sommaire** pour aller directement à elle.",
        {
          steps: [
            "Quand les sections sont prêtes, cliquez sur **Soumettre pour revue** dans le cadre **Revue et finalisation**. Le rapport passe **En revue** et les membres concernés sont prévenus. Pour reprendre la rédaction, cliquez sur **Repasser en brouillon**.",
            "Quand le rapport est en revue, un propriétaire clique sur **Finaliser**. Les sections passent en lecture seule pour tout le monde, propriétaires compris, et un PDF de la version finale est enregistré avec les exports du rapport.",
            "Pour corriger un rapport final, un propriétaire clique sur **Rouvrir en brouillon**.",
          ],
        },
        "Pour télécharger le rapport, cliquez sur **Exporter en .docx** ou **Exporter en PDF** en haut de la page. Le téléchargement commence dès que le fichier est prêt. La liste **Exports récents** garde les derniers fichiers. Un rapport trop long pour un PDF s'exporte en .docx.",
        {
          figure: "rapportRevue",
          caption: "Les boutons d'export et le cadre « Revue et finalisation » d'un rapport en brouillon.",
        },
        "Seuls les propriétaires et les administrateurs exportent un rapport. Les experts et les lecteurs le lisent dans l'application.",
      ],
    },
    {
      id: "abonnement",
      title: "Abonnement",
      body: [
        "L'offre couvre l'organisation et tous ses espaces de travail, sauf ceux couverts par un Pass Mission. Ouvrez **Abonnement** dans le menu. Le propriétaire de l'organisation, et les propriétaires et administrateurs de ses espaces, voient cette page.",
        "Vous y trouvez :",
        {
          list: [
            "l'offre en cours et sa date de fin ;",
            "**Utilisation** : les membres, les rapports actifs et les brouillons IA du mois, comparés aux limites de l'offre ;",
            "**Offres** : les abonnements Indépendant et Cabinet sur 1, 3 ou 12 mois, le Pass Mission et le Pack IA, chacun avec son bouton **Payer** ;",
            "l'**Historique des paiements** et les **Reçus**, à télécharger en PDF ;",
            "les **Coordonnées de facturation** imprimées sur les prochains reçus.",
          ],
        },
        {
          figure: "abonnement",
          caption: "La page Abonnement d'une organisation.",
        },
        "Seuls le propriétaire de l'organisation et les propriétaires de ses espaces de travail peuvent payer. Le paiement se fait sur la page de FedaPay, par Mobile Money ou carte bancaire. Il n'y a aucun prélèvement automatique : chaque paiement couvre sa période, et KolabReport vous écrit avant la fin.",
        `À la fin d'une période, vous gardez ${GRACE_DAYS} jours d'accès complet pour renouveler. Ensuite, l'espace passe en lecture seule : vous pouvez lire et exporter les rapports, mais plus les modifier. Les prix sont sur la page [Tarifs](/tarifs).`,
      ],
    },
  ],
};
