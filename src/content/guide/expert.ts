import { MAX_SECTION_CONTENT } from "@/lib/sections";
import type { GuidePart } from "./types";

// Part 2 of the guide: what an expert does in a section. Every label in bold
// is the exact text of the button, link or field in messages/fr.json.

const NUMBER = new Intl.NumberFormat("fr-FR");

export const expertPart: GuidePart = {
  id: "expert",
  title: "Expert",
  intro: [
    "Un expert rédige les sections qui lui sont attribuées. Il lit tout le rapport de son espace de travail, mais ne modifie que ses sections : il y dépose ses livrables, demande un brouillon à l'IA, écrit le texte et marque la section comme terminée.",
  ],
  sections: [
    {
      id: "vos-sections",
      title: "Trouver vos sections",
      body: [
        "Vous recevez une invitation par e-mail. Ouvrez le lien et cliquez sur **Rejoindre l'espace**. Si vous n'avez pas encore de compte, cliquez sur **Créer mon compte** et utilisez l'adresse qui a reçu l'invitation.",
        "Le **Tableau de bord** liste les rapports de l'espace et leurs sections, avec leur expert et leur statut. Ouvrez un rapport : vos sections portent la mention **Votre section** et un lien **Modifier**, qui ouvre la page de la section.",
        "Si vous travaillez pour plusieurs cabinets, le sélecteur d'espace en haut du menu range vos espaces par organisation. Seule l'organisation de votre espace actuel est ouverte : cliquez sur le nom d'une autre pour voir ses espaces, puis sur **Tous les rapports** pour voir tous ses rapports. **Rechercher un espace** retrouve un espace par son nom ou par celui de son organisation.",
        "En haut de la page de la section, vous trouvez son statut, son expert et les **Consignes pour l'IA** écrites par le coordinateur. Lisez-les avant de commencer : elles disent ce que la section doit contenir.",
        "Le texte déjà écrit est replié sous **Contenu de la section**. Cliquez sur **Aperçu** pour le lire, et sur **Masquer l'aperçu** pour le replier. Après un enregistrement ou un brouillon accepté, il s'affiche tout seul.",
        {
          figure: "section",
          caption: "La page d'une section attribuée à l'experte.",
        },
      ],
    },
    {
      id: "livrables",
      title: "Déposer vos livrables",
      body: [
        "Les livrables sont vos documents de travail : notes de terrain, tableaux de mesures, études, photos. L'IA s'appuie sur eux pour rédiger le brouillon de la section.",
        {
          steps: [
            "Sur la page de votre section, descendez jusqu'à **Déposer des livrables**.",
            "Glissez vos fichiers dans la zone, ou cliquez sur **Choisir des fichiers**. Vous pouvez en envoyer plusieurs à la fois.",
            "Chaque fichier passe par l'envoi et la vérification, puis apparaît dans la liste **Livrables**.",
          ],
        },
        "Formats acceptés : Word, Excel, PowerPoint, PDF, texte, images et schémas draw.io ou Visio. 50 Mo maximum par fichier, 5 Mo pour un SVG.",
        "L'application lit les fichiers Word, Excel, CSV, texte, Markdown et PDF. Leur badge passe à **Analysé** : leur texte servira au brouillon. Les présentations, les images et les schémas sont gardés avec la section mais marqués **Non analysé** : l'IA ne les lit pas.",
        "Un PDF sans texte lisible, comme un document scanné, ou protégé par un mot de passe est aussi marqué **Non analysé**, avec un message qui dit pourquoi. Il reste téléchargeable. Un PDF déposé avant que l'application lise les PDF affiche le bouton **Analyser** : cliquez dessus pour que son texte serve au brouillon.",
        {
          figure: "livrables",
          caption: "La zone de dépôt et la liste des livrables d'une section.",
        },
        "Sur un fichier analysé, **Aperçu** montre « Ce que l'IA lira ». **Télécharger** récupère le fichier. Si l'analyse échoue, cliquez sur **Relancer l'analyse**. L'icône de corbeille supprime un fichier que vous avez déposé : il ne servira plus aux brouillons.",
      ],
    },
    {
      id: "brouillons-ia",
      title: "Obtenir un brouillon de l'IA",
      body: [
        "Il faut au moins un livrable au statut **Analysé**. Ensuite :",
        {
          steps: [
            "Sous **Brouillon de l'IA**, choisissez un **Modèle de prompt**. La ligne « Résultat » en dessous indique ce qu'il produit, par exemple « Brouillon de section ».",
            "Cliquez sur **Générer un brouillon**. Le texte apparaît dans l'**Aperçu en direct** au fil de la rédaction. **Arrêter** interrompt la génération sans rien enregistrer. Sous le bouton, la page indique les brouillons IA qui restent ce mois-ci.",
            "Le brouillon s'affiche sous **Brouillon proposé**. Relisez-le. L'onglet **Différences** le compare au texte actuel de la section.",
            "Décidez : **Accepter** met le brouillon dans la section. **Modifier avant d'accepter** ouvre le texte pour le corriger, puis **Accepter ce texte**. **Rejeter** le laisse de côté, la section ne change pas.",
          ],
        },
        {
          figure: "brouillonIa",
          caption: "Un brouillon proposé par l'IA, en attente de votre décision.",
        },
        "Un brouillon reste une proposition tant que personne ne l'a accepté. Accepter un brouillon fait passer une section **Non commencée** à **En cours**.",
        "Après un brouillon, dites s'il vous a été utile avec **Utile** ou **Pas utile**, et ajoutez un commentaire si vous voulez, puis cliquez sur **Envoyer mon avis**. Ces avis servent à améliorer les modèles.",
        "Chaque brouillon reçu compte dans les brouillons IA de l'offre de votre organisation. Une erreur de l'IA ne compte pas. Le nombre de brouillons par personne et par heure est aussi limité : si vous atteignez une limite, le message dit quand réessayer.",
      ],
    },
    {
      id: "editeur",
      title: "Écrire dans l'éditeur",
      body: [
        "Pour écrire ou corriger le texte de la section, cliquez sur **Modifier le texte**. L'éditeur propose deux onglets sur le même texte.",
        "L'onglet **Texte** fonctionne comme un traitement de texte. La barre d'outils met en forme : **Titre 1**, **Titre 2**, **Titre 3**, **Gras**, **Italique**, **Barré**, **Liste à puces**, **Liste numérotée**, **Citation**, **Lien** et **Insérer un tableau**. Au clavier, Alt+F10 va à la barre d'outils et Échap revient au texte.",
        {
          figure: "editeurTexte",
          caption: "L'onglet Texte, avec sa barre de mise en forme.",
        },
        "Un texte copié depuis Word garde ses titres, ses listes et ses tableaux. Les mises en page complexes ne sont pas reprises, ni les images : ajoutez-les comme expliqué dans la partie suivante.",
        "L'onglet **Markdown** montre le même texte en Markdown : `##` devant un titre, `-` devant un élément de liste, `|` entre les colonnes d'un tableau. Le bouton **Aperçu** affiche le rendu. Cet onglet sert aux personnes qui préfèrent écrire en Markdown, ou à un texte trop long ou trop complexe pour l'onglet Texte. L'éditeur rouvre le dernier onglet utilisé sur votre appareil.",
        {
          figure: "editeurMarkdown",
          caption: "Le même texte dans l'onglet Markdown.",
        },
        `Cliquez sur **Enregistrer**, ou faites Ctrl+S (Cmd+S sur Mac). Un texte compte ${NUMBER.format(MAX_SECTION_CONTENT)} caractères au plus. Un texte vide efface le contenu de la section.`,
        "Si quelqu'un a modifié la section pendant que vous écriviez, l'éditeur affiche les deux versions pour les comparer. Choisissez **Garder ma version** ou **Reprendre la version enregistrée**. En attendant, votre texte reste dans l'éditeur.",
      ],
    },
    {
      id: "images-dans-le-texte",
      title: "Mettre des images dans le texte",
      body: [
        "Les photos de terrain et les schémas peuvent aller dans le texte de la section, au format PNG ou JPEG. Une image du texte est toujours un livrable de la section : les mêmes personnes la voient.",
        {
          steps: [
            "Dans la liste **Livrables**, cliquez sur **Insérer dans le texte** à côté d'une image PNG ou JPEG. L'éditeur s'ouvre avec l'image à l'endroit du curseur, ou à la fin du texte s'il était fermé.",
            "Vous pouvez aussi coller une image (Ctrl+V) ou la glisser dans l'éditeur, dans l'onglet **Texte** comme dans l'onglet **Markdown**. Elle est d'abord déposée comme livrable, puis placée là où vous l'avez mise. Si l'envoi est refusé, l'éditeur dit pourquoi.",
            "Cliquez sur **Enregistrer**. L'image s'affiche dans l'**Aperçu** de la section et dans le texte du rapport.",
          ],
        },
        "La légende est le nom du fichier, sans son extension. Pour la changer, ouvrez l'onglet **Markdown** et modifiez le texte entre crochets, juste après `![`.",
        "Les autres formats (WebP, GIF, SVG, draw.io, Visio) restent des livrables à télécharger. Pour mettre un schéma dans le texte, exportez-le d'abord en PNG.",
        "Accepter un brouillon de l'IA remplace tout le texte de la section, images comprises : insérez-les de nouveau depuis la liste **Livrables**. Si une image est supprimée des livrables, le texte n'affiche plus que sa légende, suivie de « (image indisponible) ».",
      ],
    },
    {
      id: "soumettre-la-section",
      title: "Soumettre votre section",
      body: [
        "Une section a trois statuts : **Non commencée**, **En cours** et **Terminée**. Vous les changez dans le menu **Statut de la section**, en haut de la page de la section.",
        {
          steps: [
            "Relisez une dernière fois le texte et vérifiez les faits, les chiffres et les sources.",
            "Dans **Statut de la section**, choisissez **Terminée**.",
          ],
        },
        "Le coordinateur voit le changement tout de suite sur son tableau de bord, et l'avancement du rapport augmente. Il soumet ensuite le rapport pour revue, puis un propriétaire le finalise.",
        "Pour reprendre une section terminée, remettez-la **En cours**. Quand le rapport est final, toutes ses sections passent en lecture seule : demandez à un propriétaire de le rouvrir.",
      ],
    },
  ],
};
