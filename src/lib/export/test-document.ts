// Test helper: a report that touches every block the exports draw.
import type { ExportDocument } from "./types";

export const FRENCH_SAMPLE = "Œuvre « été » à 12 € \u2013 déjà";

export const SAMPLE_MARKDOWN = `Le maître d'œuvre a mesuré la façade sud : **chaleur très élevée** en *après-midi*, \`T_max\` relevée.

# Constats

${FRENCH_SAMPLE}, coût 1 000,50 €.

Voir le [rapport complet](https://exemple.bj/rapport) et <https://exemple.bj/annexe>.

![Plan du site](https://exemple.bj/plan.png)

<script>alert("x")</script>

## Mesures

| Zone | Température | Humidité |
| :--- | :---: | ---: |
| Façade nord | 24,5 °C | 60 % |
| Toiture | **38 °C** | 35 % |

### Étapes

1. Mesurer les températures
2. Calculer les apports
   - Apports solaires
     - Vitrages
   - Apports internes
3. Rédiger

- [x] Visite faite
- [ ] Rapport relu

> Le confort d'été est faible.
> > Citation imbriquée.

\`\`\`
SELECT zone, AVG(t) FROM mesures
  GROUP BY zone;
\`\`\`

---

~~Ancienne étude~~ remplacée.
`;

export const SAMPLE_DOCUMENT: ExportDocument = {
  title: "Étude thermique : bâtiment « Les Palmiers »",
  workspaceName: "Cabinet Dossou & Associés",
  generatedAt: new Date("2026-10-14T09:30:00Z"),
  sections: [
    {
      title: "Contexte et périmètre",
      status: "completed",
      assigneeName: "Fatou Dossou",
      markdown: SAMPLE_MARKDOWN,
    },
    { title: "Recommandations", status: "in_progress", assigneeName: null, markdown: "   \n" },
    { title: "Annexes", status: "not_started", assigneeName: "Koffi Agbo", markdown: null },
  ],
};
