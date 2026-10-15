import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { offerTerms } from "../../src/lib/billing/catalog";
import { pdfText, squash } from "../../src/lib/export/test-pdf-text";
import { expectNoAxeViolations } from "./a11y";
import {
  addParsedDeliverable,
  adminClient,
  createTestUser,
  createWorkspaceFor,
  setPlan,
  type TestUser,
} from "./supabase";

// KRB-177: the billing page, the usage meter and the receipts (ADR 001,
// sections 3.5 and 9). Owners see and buy, admins see, experts and viewers
// get no link and a 404, and a receipt never leaves its organization.
// Payments go through the FedaPay mock of tests/fedapay-mock/server.mjs.
// Each test starts its own organization, on the trial unless it says
// otherwise.
test.describe.configure({ mode: "serial" });

const MOCK = `http://127.0.0.1:${process.env.FEDAPAY_MOCK_PORT || 4010}`;
const PAY_PAGE = new RegExp(`^${MOCK.replaceAll(".", "\\.")}/pay/[0-9a-f]+`);
const RETURN_PAGE = /\/fr\/organisations\/[0-9a-f-]{36}\/abonnement\/retour\/[0-9a-f-]{36}/;
const RECEIPT_NUMBER = /^KR-\d{4}-\d{6}$/;

async function signIn(page: Page, user: TestUser) {
  await page.context().clearCookies();
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

function navigation(page: Page) {
  return page.getByRole("navigation", { name: "Navigation de l'application" });
}

/** A paid Indépendant month, granted the way the webhook does it. */
async function paidPurchase(organizationId: string, buyer: TestUser) {
  const admin = adminClient();
  const { data, error } = await admin
    .rpc("billing_create_purchase", {
      p_organization_id: organizationId,
      p_offer: "independant_1m",
      p_offer_label: "Indépendant, 1 mois",
      p_catalog_version: 1,
      p_quantity: 1,
      p_terms: offerTerms("independant_1m"),
      p_amount_ht_xof: 15_000,
      p_tax_xof: 0,
      p_environment: "mock",
      p_created_by: buyer.id,
      p_reuse: false,
    })
    .single();
  if (error || !data?.purchase_id) throw error ?? new Error("no purchase");
  // Far from the mock's own ids.
  const transactionId = 8_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
  const linked = await admin.rpc("billing_set_transaction", {
    p_purchase_id: data.purchase_id,
    p_transaction_id: transactionId,
  });
  if (linked.error) throw linked.error;
  const applied = await admin
    .rpc("billing_apply_transaction", {
      p_purchase_id: data.purchase_id,
      p_source: "reconcile",
      p_transaction_id: transactionId,
      p_status: "approved",
      p_amount_xof: 15_000,
      p_environment: "mock",
      p_currency: "XOF",
      p_merchant_reference: data.merchant_reference,
    })
    .single();
  if (applied.error || applied.data?.outcome !== "granted") throw applied.error ?? new Error("not granted");
  const { data: receipt, error: receiptError } = await admin
    .from("billing_receipts")
    .select("id, number")
    .eq("purchase_id", data.purchase_id)
    .single();
  if (receiptError || !receipt) throw receiptError ?? new Error("no receipt");
  return receipt;
}

async function addMember(workspaceId: string, user: TestUser, role: "admin" | "expert" | "viewer") {
  const { error } = await adminClient()
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: user.id, role });
  if (error) throw error;
}

test("the owner sees the plan and the meter, pays, and downloads the receipt", async ({ page }) => {
  const owner = await createTestUser("Olga Abonnee");
  const { api, organization_id: organizationId } = await createWorkspaceFor(owner, "Compta Bohicon");
  const billingUrl = `/fr/organisations/${organizationId}/abonnement`;
  const { data: overview } = await api.rpc("billing_overview", { p_organization_id: organizationId });
  expect(overview, "supabase/seed.sql turns billing on for local and CI runs").toMatchObject({
    enforced: true,
  });

  await signIn(page, owner);
  await navigation(page).getByRole("link", { name: "Abonnement" }).click();
  await page.waitForURL(`**${billingUrl}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Abonnement de Cabinet Compta Bohicon");
  await expect(page.getByText("État : Essai gratuit")).toBeVisible();
  await expect(page.getByText(/^Essai gratuit jusqu'au \d{1,2} \S+ \d{4}\.$/)).toBeVisible();

  // The meter: the owner, the wizard's report, no draft yet, no pack.
  const usage = page.getByRole("region", { name: "Utilisation" });
  await expect(usage.getByText("1 membre sur 5", { exact: true })).toBeVisible();
  await expect(usage.getByText("1 rapport actif sur 1", { exact: true })).toBeVisible();
  await expect(usage.getByRole("heading", { name: "Brouillons IA de l'essai" })).toBeVisible();
  await expect(usage.getByText("Aucun brouillon IA sur 20", { exact: true })).toBeVisible();
  await expect(usage.getByText("Aucun brouillon IA restant", { exact: true })).toBeVisible();

  // One period rule per offer.
  const offers = page.getByRole("region", { name: "Offres", exact: true });
  await expect(
    offers.getByText("Les jours d'essai restants s'ajoutent à votre première période."),
  ).toHaveCount(2);
  await expect(
    offers.getByText("Le Pack IA s'ajoute à une offre payante ou à un Pass Mission en cours, pas à l'essai."),
  ).toBeVisible();
  await expect(page.getByText("Aucun paiement pour le moment.")).toBeVisible();

  // The billing details go on the next receipt.
  const details = page.getByRole("region", { name: "Coordonnées de facturation" });
  await details.getByLabel("Raison sociale").fill("Compta Bohicon SARL");
  await details.getByLabel("Adresse").fill("Quartier Zakpo, Bohicon");
  await details.getByLabel("IFU").fill("3201900000123");
  await details.getByLabel("E-mail de facturation").fill("Factures@Compta-Bohicon.test");
  await details.getByRole("button", { name: "Enregistrer" }).click();
  await expect(details.getByRole("status")).toHaveText("Coordonnées enregistrées.");

  // Paid through FedaPay's (mock) page.
  await page.getByRole("button", { name: /^Payer Indépendant, 1 mois,/ }).click();
  await page.waitForURL(PAY_PAGE);
  await page.getByRole("button", { name: "Approuver" }).click();
  await page.waitForURL(RETURN_PAGE);
  await page.getByRole("link", { name: "Retour à l'abonnement" }).click();
  await page.waitForURL(`**${billingUrl}`);

  await expect(page.getByText(/^Offre en cours : Indépendant, jusqu'au/)).toBeVisible();
  await expect(usage.getByText("1 membre sur 3", { exact: true })).toBeVisible();
  await expect(usage.getByText("1 rapport actif sur 3", { exact: true })).toBeVisible();
  await expect(usage.getByRole("heading", { name: "Brouillons IA ce mois-ci" })).toBeVisible();
  await expect(
    offers
      .getByRole("region", { name: "Indépendant" })
      .getByText("Votre nouvelle période commence à la fin de la période en cours."),
  ).toBeVisible();
  await expect(
    offers
      .getByRole("region", { name: "Cabinet" })
      .getByText("Vos jours restants sont convertis en jours de la nouvelle offre."),
  ).toBeVisible();

  // The history and the receipt.
  const history = page.getByRole("region", { name: "Historique des paiements" });
  const row = history.getByRole("row", { name: /Indépendant, 1 mois/ });
  await expect(row).toContainText(/15\s000\sFCFA/);
  await expect(row).toContainText("Payé");
  const receipts = page.getByRole("region", { name: "Reçus" });
  const number = (await receipts.getByRole("rowheader").first().innerText()).split(/\s/)[0]!;
  expect(number).toMatch(RECEIPT_NUMBER);
  await expect(receipts.getByText("Test", { exact: true })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    receipts.getByRole("link", { name: `Télécharger le reçu ${number} en PDF` }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`recu-${number}.pdf`);
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const text = squash(pdfText(pdf));
  for (const part of [
    "Reçu de paiement",
    `N° ${number}`,
    "Mocktar Technologies",
    "IFU : 1200900488800",
    "Compta Bohicon SARL",
    "Quartier Zakpo, Bohicon",
    "IFU : 3201900000123",
    "factures@compta-bohicon.test",
    "Indépendant, 1 mois",
    "Total payé15 000 FCFA",
    "Taxes0 FCFA",
    "Moyen de paiement : Mobile money de test",
    "Reçu de test, sans valeur comptable",
  ]) {
    expect(text).toContain(squash(part));
  }

  // The same link answers a PDF that is never cached.
  const response = await page.request.get(
    (await receipts
      .getByRole("link", { name: `Télécharger le reçu ${number} en PDF` })
      .getAttribute("href"))!,
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  expect(response.headers()["content-disposition"]).toBe(`attachment; filename="recu-${number}.pdf"`);
  expect(response.headers()["cache-control"]).toBe("private, no-store");

  await expectNoAxeViolations(page, "billing page of an owner, with a payment", { soft: false });
});

test("an admin reads the page and downloads receipts, without buying or editing", async ({ page }) => {
  const [owner, admin] = await Promise.all([createTestUser("Odon Proprio"), createTestUser("Adele Admin")]);
  const { organization_id: organizationId, workspace_id: workspaceId } = await createWorkspaceFor(
    owner,
    "Gestion Ouidah",
  );
  await addMember(workspaceId, admin, "admin");
  const receipt = await paidPurchase(organizationId, owner);

  await signIn(page, admin);
  await navigation(page).getByRole("link", { name: "Abonnement" }).click();
  await page.waitForURL(`**/fr/organisations/${organizationId}/abonnement`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Abonnement de Cabinet Gestion Ouidah");
  await expect(
    page.getByText(
      "Seuls le propriétaire de l'organisation et les propriétaires de ses espaces de travail peuvent payer.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Payer/ })).toHaveCount(0);

  const details = page.getByRole("region", { name: "Coordonnées de facturation" });
  await expect(details.getByRole("textbox")).toHaveCount(0);
  await expect(details.getByRole("button", { name: "Enregistrer" })).toHaveCount(0);

  const receipts = page.getByRole("region", { name: "Reçus" });
  await expect(receipts.getByRole("rowheader", { name: new RegExp(`^${receipt.number}`) })).toBeVisible();
  const response = await page.request.get(`/api/billing/receipts/${receipt.id}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");

  await expectNoAxeViolations(page, "billing page of an admin", { soft: false });
});

test("experts and viewers get no link, and a 404 on the page and the receipts", async ({ page }) => {
  const [owner, expert, viewer] = await Promise.all([
    createTestUser("Omer Payeur"),
    createTestUser("Eloi Expert"),
    createTestUser("Vera Lectrice"),
  ]);
  const { organization_id: organizationId, workspace_id: workspaceId } = await createWorkspaceFor(
    owner,
    "Audit Natitingou",
  );
  await addMember(workspaceId, expert, "expert");
  await addMember(workspaceId, viewer, "viewer");
  const receipt = await paidPurchase(organizationId, owner);

  for (const user of [expert, viewer]) {
    await signIn(page, user);
    await page.goto("/fr/tableau-de-bord");
    await expect(navigation(page).getByRole("link", { name: "Tableau de bord" })).toBeVisible();
    await expect(navigation(page).getByRole("link", { name: "Abonnement" })).toHaveCount(0);

    const answer = await page.goto(`/fr/organisations/${organizationId}/abonnement`);
    expect(answer?.status(), `${user.name} gets a 404 on the billing page`).toBe(404);
    const download = await page.request.get(`/api/billing/receipts/${receipt.id}`);
    expect(download.status(), `${user.name} gets a 404 on the receipt`).toBe(404);
  }
});

test("a receipt of another organization is a 404, and so is its billing page", async ({ page }) => {
  const [ownerA, ownerB] = await Promise.all([
    createTestUser("Alix Premier"),
    createTestUser("Basile Second"),
  ]);
  const [{ organization_id: organizationA }] = await Promise.all([
    createWorkspaceFor(ownerA, "Premier Lokossa"),
    createWorkspaceFor(ownerB, "Second Lokossa"),
  ]);
  const receipt = await paidPurchase(organizationA, ownerA);

  await signIn(page, ownerB);
  const download = await page.request.get(`/api/billing/receipts/${receipt.id}`);
  expect(download.status()).toBe(404);
  expect(download.headers()["cache-control"]).toBe("private, no-store");
  const answer = await page.goto(`/fr/organisations/${organizationA}/abonnement`);
  expect(answer?.status()).toBe(404);

  // Signed out, the route asks for a session.
  await page.context().clearCookies();
  expect((await page.request.get(`/api/billing/receipts/${receipt.id}`)).status()).toBe(401);
});

test("usage hints on the members page, the report dialog and the AI draft panel", async ({ page }) => {
  const owner = await createTestUser("Hilaire Indices");
  const {
    api,
    workspace_id: workspaceId,
    report_id: reportId,
    organization_id: organizationId,
  } = await createWorkspaceFor(owner, "Indices Djougou");
  await setPlan(organizationId, "independant");
  const { data: section, error } = await api
    .from("report_sections")
    .insert({ workspace_id: workspaceId, report_id: reportId, title: "Constats", assigned_to: owner.id })
    .select("id")
    .single();
  if (error || !section) throw error ?? new Error("Could not create the section");
  await addParsedDeliverable(workspaceId, section.id, owner.id, "constats.md", "## Constats\n\nRAS.");

  await signIn(page, owner);
  await page.goto(`/fr/espaces/${workspaceId}/membres`);
  await expect(
    page.getByRole("main").getByText("Offre Indépendant : 1 membre sur 3. Les lecteurs sont gratuits."),
  ).toBeVisible();

  await page.goto("/fr/tableau-de-bord");
  const reports = page.getByRole("main").getByRole("region", { name: "Rapports", exact: true });
  await reports.getByRole("button", { name: "Nouveau rapport" }).click();
  const dialog = page.getByRole("dialog", { name: "Nouveau rapport" });
  await expect(
    dialog.getByText("Offre Indépendant : 1 rapport actif sur 3. Un rapport final ne compte plus."),
  ).toBeVisible();

  await page.goto(`/fr/espaces/${workspaceId}/sections/${section.id}`);
  await expect(
    page
      .getByRole("region", { name: "Brouillon de l'IA" })
      .getByText("60 brouillons IA restants ce mois-ci."),
  ).toBeVisible();
});
