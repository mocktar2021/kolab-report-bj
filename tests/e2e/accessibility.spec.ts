import { expect, test, type Page } from "@playwright/test";
import { THEMES, expectNoAxeViolations, signIn, useTheme } from "./a11y";
import {
  addParsedDeliverable,
  adminClient,
  createTestUser,
  createWorkspaceFor,
  type TestUser,
} from "./supabase";

// KRB-155: axe audit (WCAG 2.1 A and AA) of the public pages, the signed-in
// pages and the interactive states Lighthouse does not reach: the AI draft
// proposal, dialogs, menus and the command palette. Every page runs in the
// light and the dark theme, for color contrast. The app runs with
// AI_PROVIDER=mock, so drafts need no model and no Storage.

type Setup = {
  owner: TestUser;
  expert: TestUser;
  workspaceId: string;
  reportId: string;
  sectionId: string;
  fileName: string;
};

let setup: Setup;

const PARSED = `## Relevés

La chaufferie consomme 38 % de l'énergie du site. Les relevés de février montrent deux pics.

| Mois | MWh |
| --- | --- |
| Janvier | 31 |
| Février | 36 |`;

test.beforeAll(async () => {
  const [owner, expert] = await Promise.all([createTestUser("Adele Acces"), createTestUser("Yao Expert")]);
  const {
    api,
    workspace_id: workspaceId,
    report_id: reportId,
  } = await createWorkspaceFor(owner, "Accessibilité Porto-Novo");
  const admin = adminClient();
  const { error: memberError } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: expert.id, role: "expert" });
  if (memberError) throw memberError;

  // The owner's section holds the file and the drafts; the expert's section
  // makes the expert hear about the report's status (notifications).
  const { data: sections, error } = await api
    .from("report_sections")
    .insert([
      {
        workspace_id: workspaceId,
        report_id: reportId,
        title: "Diagnostic de la chaufferie",
        position: 0,
        assigned_to: owner.id,
        content: "## Constat\n\nLa chaufferie date de 1998.",
      },
      {
        workspace_id: workspaceId,
        report_id: reportId,
        title: "Recommandations",
        position: 1,
        assigned_to: expert.id,
        content: null,
      },
    ])
    .select("id, title");
  if (error || !sections) throw error ?? new Error("Could not create the sections");
  const sectionId = sections.find((section) => section.title === "Diagnostic de la chaufferie")?.id;
  if (!sectionId) throw new Error("No section id");
  const fileName = "releves-chaufferie.md";
  await addParsedDeliverable(workspaceId, sectionId, owner.id, fileName, PARSED);

  const { error: transitionError } = await api
    .rpc("transition_report_status", { p_report_id: reportId, p_from: "draft", p_to: "in_review" })
    .single();
  if (transitionError) throw transitionError;

  setup = { owner, expert, workspaceId, reportId, sectionId, fileName };
});

function sectionUrl() {
  return `/fr/espaces/${setup.workspaceId}/sections/${setup.sectionId}`;
}

async function visit(page: Page, url: string, heading: string | RegExp) {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
}

for (const theme of THEMES) {
  test.describe(`${theme === "light" ? "light" : "dark"} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await useTheme(page, theme);
    });

    test("public pages have no axe violations", async ({ page }) => {
      const pages: Array<[string, string | RegExp]> = [
        ["/fr", /Une section par expert/],
        ["/fr/connexion", "Connexion"],
        ["/fr/inscription", "Créer un compte"],
        ["/fr/mot-de-passe-oublie", "Mot de passe oublié"],
        ["/fr/hors-ligne", "Vous êtes hors ligne"],
        ["/fr/tarifs", "Des offres claires, en FCFA"],
      ];
      for (const [url, heading] of pages) {
        await test.step(url, async () => {
          await visit(page, url, heading);
          await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
          await expectNoAxeViolations(page, `${url} (${theme})`);
        });
      }

      await test.step("/fr/connexion with an error", async () => {
        await page.goto("/fr/connexion");
        await page.getByLabel("Adresse e-mail").fill(setup.owner.email);
        await page.getByLabel("Mot de passe", { exact: true }).fill("pas-le-bon");
        await page.getByRole("button", { name: "Se connecter" }).click();
        await expect(page.getByRole("main").getByRole("alert")).toHaveText(
          "Adresse e-mail ou mot de passe incorrect.",
        );
        await expectNoAxeViolations(page, `/fr/connexion error (${theme})`);
      });
    });

    test("signed-in pages have no axe violations", async ({ page }) => {
      await signIn(page, setup.owner);
      const { workspaceId, reportId } = setup;
      const pages: Array<[string, string | RegExp]> = [
        ["/fr/tableau-de-bord", "Tableau de bord"],
        [`/fr/espaces/${workspaceId}/membres`, "Membres de Accessibilité Porto-Novo"],
        [`/fr/rapports/${reportId}`, "Rapport Accessibilité Porto-Novo"],
        [sectionUrl(), "1. Diagnostic de la chaufferie"],
        [`/fr/espaces/${workspaceId}/modeles`, "Modèles de prompts"],
        [`/fr/espaces/${workspaceId}/ia`, "Pilotage de l'IA"],
        ["/fr/notifications", "Notifications"],
        ["/fr/espaces/nouveau", "Créer un espace de travail"],
      ];
      for (const [url, heading] of pages) {
        await test.step(url, async () => {
          await visit(page, url, heading);
          await expectNoAxeViolations(page, `${url} (${theme})`);
        });
      }
    });

    test("the section page's interactive states have no axe violations", async ({ page }) => {
      await signIn(page, setup.owner);
      await visit(page, sectionUrl(), "1. Diagnostic de la chaufferie");
      const main = page.getByRole("main");
      const files = main.getByRole("region", { name: "Livrables", exact: true });

      await test.step("deliverable preview open", async () => {
        await files.getByRole("button", { name: `Aperçu de ${setup.fileName}` }).click();
        await expect(files.getByText("Ce que l'IA lira")).toBeVisible();
        await expectNoAxeViolations(page, `deliverable preview (${theme})`);
        await files.getByRole("button", { name: `Masquer l'aperçu de ${setup.fileName}` }).click();
      });

      await test.step("delete dialog open", async () => {
        await files.getByRole("button", { name: `Supprimer ${setup.fileName}` }).click();
        await expect(page.getByRole("dialog", { name: `Supprimer ${setup.fileName} ?` })).toBeVisible();
        await expectNoAxeViolations(page, `delete dialog (${theme})`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
      });

      await test.step("AI draft proposal, preview and differences", async () => {
        await main.getByRole("button", { name: "Générer un brouillon" }).click();
        await expect(main.getByRole("status").filter({ hasText: "Brouillon prêt" })).toBeVisible();
        await expect(main.getByRole("heading", { name: "Brouillon proposé" })).toBeVisible();
        await expectNoAxeViolations(page, `draft proposal (${theme})`);
        await main.getByRole("tab", { name: "Différences" }).click();
        await expect(main.getByRole("group", { name: /Lignes ajoutées et supprimées/ })).toBeVisible();
        await expectNoAxeViolations(page, `draft differences (${theme})`);
        await main.getByRole("button", { name: "Modifier avant d'accepter" }).click();
        await expect(main.getByLabel("Texte à accepter (Markdown)")).toBeFocused();
        await expectNoAxeViolations(page, `draft editor (${theme})`);
        await main.getByRole("button", { name: "Annuler" }).click();
      });
    });

    test("menus, dialogs and the command palette have no axe violations", async ({ page }) => {
      await signIn(page, setup.owner);
      await visit(page, "/fr/tableau-de-bord", "Tableau de bord");

      await test.step("command palette", async () => {
        await page.keyboard.press("Control+K");
        await expect(page.getByRole("dialog", { name: "Palette de commandes" })).toBeVisible();
        await expectNoAxeViolations(page, `command palette (${theme})`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
      });

      await test.step("theme menu", async () => {
        await page
          .getByRole("banner")
          .getByRole("button", { name: /^Thème/ })
          .click();
        await expect(page.getByRole("menu")).toBeVisible();
        await expectNoAxeViolations(page, `theme menu (${theme})`);
        await page.keyboard.press("Escape");
        // The menu fades out before it leaves the page.
        await expect(page.getByRole("menu")).toHaveCount(0);
      });

      await test.step("workspace menu", async () => {
        await page.getByRole("button", { name: /^Espace de travail actuel/ }).click();
        await expect(page.getByRole("menu")).toBeVisible();
        await expectNoAxeViolations(page, `workspace menu (${theme})`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
      });

      await test.step("new report dialog with a title error", async () => {
        await page.getByRole("button", { name: "Nouveau rapport" }).click();
        const dialog = page.getByRole("dialog", { name: "Nouveau rapport" });
        await dialog.getByRole("button", { name: "Créer le rapport" }).click();
        await expect(dialog.getByText("Saisissez entre 2 et 200 caractères.")).toBeVisible();
        await expectNoAxeViolations(page, `new report dialog (${theme})`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
      });

      await test.step("remove member dialog", async () => {
        await visit(page, `/fr/espaces/${setup.workspaceId}/membres`, /^Membres de/);
        await page
          .getByRole("button", { name: `Retirer ${setup.expert.name} de l'espace de travail` })
          .click();
        await expect(page.getByRole("dialog", { name: `Retirer ${setup.expert.name} ?` })).toBeVisible();
        await expectNoAxeViolations(page, `remove member dialog (${theme})`);
        await page.keyboard.press("Escape");
      });

      await test.step("mobile menu", async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await visit(page, "/fr/tableau-de-bord", "Tableau de bord");
        await expectNoAxeViolations(page, `dashboard on a phone (${theme})`);
        await page.getByRole("button", { name: "Ouvrir le menu" }).click();
        await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
        await expectNoAxeViolations(page, `mobile menu (${theme})`);
        await page.keyboard.press("Escape");
      });
    });

    test("the notifications page with an unread item has no axe violations", async ({ page }) => {
      await signIn(page, setup.expert);
      await visit(page, "/fr/notifications", "Notifications");
      await expect(page.getByRole("main").getByRole("link", { name: /a soumis/ })).toBeVisible();
      await expectNoAxeViolations(page, `notifications (${theme})`);
    });
  });
}
