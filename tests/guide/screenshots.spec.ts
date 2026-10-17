import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";
import {
  FIGURE_MAX_BYTES,
  GUIDE_FIGURES,
  figureSrc,
  type GuideFigureKey,
} from "../../src/content/guide/figures";
import { settle, signIn, useTheme } from "../e2e/a11y";
import { INVITED_EMAIL, REPORT, seedDemo, type Demo } from "./demo";

// KRB-199: the screenshots of the user guide, on demo data only. Each capture
// is the browser window (1280 x 800), saved as WebP in public/guide/ under
// the name GUIDE_FIGURES gives it. Run with playwright.guide.config.ts, never
// with the end-to-end suite: it deletes and recreates the demo accounts.
test.describe.configure({ mode: "serial" });

let demo: Demo;

test.beforeAll(async () => {
  demo = await seedDemo();
});

test.beforeEach(async ({ page }) => {
  await useTheme(page, "light");
});

/** Scrolls so that `target` sits near the top of the window. */
async function scrollTo(target: Locator, offset = 24) {
  await target.evaluate((element, gap) => {
    const top = element.getBoundingClientRect().top + window.scrollY - gap;
    window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
  }, offset);
}

/** Saves the window as WebP, as small as needed to stay under FIGURE_MAX_BYTES. */
async function capture(page: Page, key: GuideFigureKey) {
  await settle(page);
  // The mouse would leave a hover state on the last button clicked.
  await page.mouse.move(0, 0);
  const png = await page.screenshot({ animations: "disabled", caret: "hide" });
  const { width, height } = GUIDE_FIGURES[key];
  let webp = Buffer.alloc(0);
  for (const quality of [80, 72, 64, 56]) {
    webp = await sharp(png)
      .resize({ width, height, fit: "cover", position: "top" })
      .removeAlpha()
      .webp({ quality, effort: 6 })
      .toBuffer();
    if (webp.length <= FIGURE_MAX_BYTES) break;
  }
  expect(webp.length, `${key} weighs too much`).toBeLessThanOrEqual(FIGURE_MAX_BYTES);
  await writeFile(path.join(process.cwd(), "public", figureSrc(key)), webp);
}

async function heading(page: Page, name: string | RegExp) {
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveText(name);
  return h1;
}

const PLAN = `1. Résumé
2. Contexte de la mission
2.1 Présentation du programme
2.2 Zone d'étude
Présenter les arrondissements couverts et leur population.
3. Déroulement de la mission
3.1 Calendrier
3.2 Équipe
4. Résultats
5. Recommandations
6. Annexes`;

const TEMPLATE_DESCRIPTION =
  "Une section qui présente l'état des ouvrages d'assainissement quartier par quartier, sur un ton factuel, avec des intertitres et la liste des réparations à prévoir.";

test("the expert's screens: section, deliverables, AI draft and editor", async ({ page }) => {
  await signIn(page, demo.people.expert);
  const main = page.getByRole("main");
  const { workspaceId, sections } = demo;

  await page.goto(`/fr/espaces/${workspaceId}/sections/${sections.diagnosis}`);
  await heading(page, /Diagnostic des ouvrages/);
  await expect(main.getByText("Analysé", { exact: true }).first()).toBeVisible();
  await scrollTo(main.getByRole("heading", { name: "Déposer des livrables" }));
  await capture(page, "livrables");

  await main.getByRole("button", { name: "Générer un brouillon" }).click();
  await expect(main.getByText("Brouillon prêt. Relisez-le avant de l'accepter.")).toBeVisible({
    timeout: 90_000,
  });
  await scrollTo(main.getByRole("heading", { name: "Brouillon proposé" }));
  await capture(page, "brouillonIa");

  await main.getByRole("button", { name: "Accepter", exact: true }).click();
  await expect(main.getByText("Brouillon accepté.", { exact: false })).toBeVisible();
  await page.reload();
  await heading(page, /Diagnostic des ouvrages/);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await capture(page, "section");

  // The context section holds a heading, a list and a table.
  await page.goto(`/fr/espaces/${workspaceId}/sections/${sections.context}`);
  await heading(page, /Contexte et objectifs/);
  await main.getByRole("button", { name: "Modifier le texte" }).click();
  await expect(main.getByRole("tab", { name: "Texte" })).toHaveAttribute("aria-selected", "true");
  await expect(main.getByRole("toolbar", { name: "Mise en forme" })).toBeVisible();
  // Without the focus ring, which would frame the text in red.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await scrollTo(main.getByRole("heading", { name: "Contenu de la section" }));
  await capture(page, "editeurTexte");

  await main.getByRole("tab", { name: "Markdown" }).click();
  await expect(main.getByLabel("Texte de la section (Markdown)")).toBeVisible();
  await scrollTo(main.getByRole("heading", { name: "Contenu de la section" }));
  await capture(page, "editeurMarkdown");
  await main.getByRole("button", { name: "Annuler" }).click();
});

test("the owner's screens: workspace, members, report, plan, templates and billing", async ({ page }) => {
  await signIn(page, demo.people.owner);
  const main = page.getByRole("main");
  const { workspaceId, reportId, secondReportId, organizationId } = demo;

  await page.goto("/fr/tableau-de-bord");
  await heading(page, "Tableau de bord");
  await expect(main.getByText(REPORT).first()).toBeVisible();
  await capture(page, "tableauDeBord");

  await main.getByRole("button", { name: "Nouveau rapport" }).click();
  const dialog = page.getByRole("dialog", { name: "Nouveau rapport" });
  await dialog.getByLabel("Titre du rapport").fill("Rapport de restitution aux communes");
  await capture(page, "nouveauRapport");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.goto("/fr/espaces/nouveau");
  await heading(page, "Créer un espace de travail");
  await capture(page, "nouvelEspace");

  await page.goto(`/fr/espaces/${workspaceId}/membres`);
  await heading(page, /^Membres de /);
  await main.getByLabel("Adresse e-mail").fill(INVITED_EMAIL);
  await main.getByLabel("Rôle", { exact: true }).selectOption({ label: "Expert" });
  await main.getByRole("button", { name: "Envoyer l'invitation" }).click();
  await expect(main.getByText(INVITED_EMAIL).first()).toBeVisible();
  // The end of the member list, the form and the pending invitation.
  await scrollTo(main.getByRole("heading", { name: "Inviter un membre" }), 300);
  await capture(page, "membres");

  await page.goto(`/fr/rapports/${reportId}`);
  await heading(page, REPORT);
  await capture(page, "rapportRevue");
  await scrollTo(main.getByRole("region", { name: "Sommaire" }));
  await capture(page, "rapportSections");

  await page.goto(`/fr/rapports/${secondReportId}/importer-le-plan`);
  await heading(page, "Importer le plan");
  await main.getByLabel("Texte du plan").fill(PLAN);
  await main.getByRole("button", { name: "Lire le texte" }).click();
  const preview = main.getByRole("region", { name: "Vérifiez le plan" });
  await expect(preview.getByRole("heading", { name: "Vérifiez le plan" })).toBeVisible();
  await scrollTo(preview);
  await capture(page, "importerLePlan");

  const library = `/fr/espaces/${workspaceId}/modeles`;
  await page.goto(`${library}/nouveau`);
  await heading(page, "Nouveau modèle");
  await capture(page, "nouveauModele");

  await page.goto(`${library}/nouveau/description`);
  await heading(page, "Décrire le modèle");
  await main.getByRole("radio", { name: /Décrire en quelques phrases/ }).check();
  await main.getByLabel("Décrivez le modèle en quelques phrases").fill(TEMPLATE_DESCRIPTION);
  await scrollTo(main.getByRole("group", { name: "Comment voulez-vous décrire le modèle ?" }));
  await capture(page, "decrireModele");

  await page.goto(`${library}/nouveau`);
  await main
    .getByRole("link", { name: /^Copier « / })
    .first()
    .click();
  await heading(page, "Nouveau modèle");
  const advanced = main.locator("summary", { hasText: "Réglages avancés" });
  await advanced.click();
  await scrollTo(advanced, 160);
  await capture(page, "reglagesAvances");

  await page.goto(`/fr/organisations/${organizationId}/abonnement`);
  await heading(page, /^Abonnement de /);
  await capture(page, "abonnement");
});
