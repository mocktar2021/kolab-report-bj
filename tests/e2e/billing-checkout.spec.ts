import { expect, test, type Page } from "@playwright/test";
import { offerTerms } from "../../src/lib/billing/catalog";
import { adminClient, createTestUser, createWorkspaceFor, type TestUser } from "./supabase";

// KRB-176: paying an offer through FedaPay (ADR 001, sections 8 and 13),
// against the mock of tests/fedapay-mock/server.mjs, which Playwright starts
// on port 4010. Its payment page has "Approuver", "Refuser" and "Annuler",
// and takes switches as query parameters: webhook=skip|twice, amount=<XOF>.
// Each test starts its own organization, on the trial.
test.describe.configure({ mode: "serial" });

const MOCK = `http://127.0.0.1:${process.env.FEDAPAY_MOCK_PORT || 4010}`;
const PAY_PAGE = new RegExp(`^${MOCK.replaceAll(".", "\\.")}/pay/[0-9a-f]+`);
const RETURN_PAGE = /\/fr\/organisations\/[0-9a-f-]{36}\/abonnement\/retour\/[0-9a-f-]{36}/;
const RECEIPT_NUMBER = /^KR-\d{4}-\d{6}$/;

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

/** A signed-in owner of a new organization, on the billing page. */
async function ownerOnBillingPage(page: Page, name: string) {
  const owner = await createTestUser(name);
  const { organization_id: organizationId, workspace_id: workspaceId } = await createWorkspaceFor(
    owner,
    `Mission ${name}`,
  );
  await signIn(page, owner);
  await page.goto(`/fr/organisations/${organizationId}/abonnement`);
  return { owner, organizationId, workspaceId };
}

/** Clicks "Payer" for an offer and waits for FedaPay's (mock) payment page. */
async function pay(page: Page, offerLabel: RegExp) {
  await page.getByRole("button", { name: offerLabel }).click();
  await page.waitForURL(PAY_PAGE);
}

async function purchasesOf(organizationId: string) {
  const { data, error } = await adminClient()
    .from("billing_purchases")
    .select("id, offer, status, review_reason, fedapay_transaction_id, fedapay_status, amount_xof")
    .eq("organization_id", organizationId)
    .order("created_at");
  if (error) throw error;
  return data;
}

async function grantsOf(purchaseId: string) {
  const admin = adminClient();
  const [{ data: entitlements }, { data: receipts }] = await Promise.all([
    admin.from("billing_entitlements").select("id, plan, ends_at").eq("purchase_id", purchaseId),
    admin.from("billing_receipts").select("number, total_xof").eq("purchase_id", purchaseId),
  ]);
  return { entitlements: entitlements ?? [], receipts: receipts ?? [] };
}

/** What the mock knows about a transaction: its status and the webhook deliveries. */
async function mockTransaction(transactionId: number) {
  const response = await fetch(`${MOCK}/__mock/transactions/${transactionId}`);
  expect(response.ok).toBe(true);
  return (await response.json()) as {
    transaction: { status: string; amount: number };
    deliveries: { eventId: number | null; status: number | string }[];
  };
}

const INDEPENDANT_1M = /^Payer Indépendant, 1 mois,/;
const CABINET_1M = /^Payer Cabinet, 1 mois,/;

test("an approved payment is granted by the webhook, with a numbered receipt", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  const { organizationId } = await ownerOnBillingPage(page, "Agnes Approuve");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /^Abonnement de Cabinet Mission Agnes Approuve$/,
  );
  await expect(page.getByText(/^Essai gratuit jusqu'au/)).toBeVisible();

  await pay(page, INDEPENDANT_1M);
  // The amount comes from the catalogue.
  await expect(page.getByText("Montant : 15000 FCFA")).toBeVisible();
  await page.getByRole("button", { name: "Approuver" }).click();

  await page.waitForURL(RETURN_PAGE);
  const [purchase] = await purchasesOf(organizationId);
  expect(purchase).toMatchObject({ offer: "independant_1m", status: "paid", fedapay_status: "approved" });
  const { entitlements, receipts } = await grantsOf(purchase!.id);
  expect(entitlements).toHaveLength(1);
  expect(entitlements[0]?.plan).toBe("independant");
  expect(receipts).toHaveLength(1);
  expect(receipts[0]?.number).toMatch(RECEIPT_NUMBER);
  expect(receipts[0]?.total_xof).toBe(15_000);
  await expect(
    page.getByText(
      new RegExp(
        `^Paiement reçu\\. Votre offre Indépendant est active jusqu'au .+\\. Le reçu ${receipts[0]?.number}`,
      ),
    ),
  ).toBeVisible();

  // The webhook did it: delivered once and answered 200.
  const mock = await mockTransaction(purchase!.fedapay_transaction_id!);
  expect(mock.deliveries.map((delivery) => delivery.status)).toEqual([200]);
  // Leaving for FedaPay's page and coming back broke no Content-Security-Policy rule.
  expect(violations).toEqual([]);

  // Back on the billing page, the plan is there.
  await page.getByRole("link", { name: "Retour à l'abonnement" }).click();
  await expect(page.getByText(/^Offre en cours : Indépendant, jusqu'au/)).toBeVisible();
});

test("a declined payment grants nothing, and Réessayer pays the same purchase", async ({ page }) => {
  const { organizationId } = await ownerOnBillingPage(page, "Denis Refuse");
  await pay(page, CABINET_1M);
  await page.getByRole("button", { name: "Refuser" }).click();

  await page.waitForURL(RETURN_PAGE);
  await expect(
    page.getByText(
      "Le paiement n'a pas abouti. Vous pouvez réessayer, avec le même moyen de paiement ou un autre.",
    ),
  ).toBeVisible();
  const [declined] = await purchasesOf(organizationId);
  expect(declined).toMatchObject({ status: "pending", fedapay_status: "declined" });
  expect((await grantsOf(declined!.id)).entitlements).toHaveLength(0);

  await page.getByRole("button", { name: "Réessayer" }).click();
  await page.waitForURL(PAY_PAGE);
  await page.getByRole("button", { name: "Approuver" }).click();
  await page.waitForURL(RETURN_PAGE);
  await expect(page.getByText(/^Paiement reçu\. Votre offre Cabinet est active jusqu'au/)).toBeVisible();

  // One purchase, one transaction, paid on the second try.
  const purchases = await purchasesOf(organizationId);
  expect(purchases).toHaveLength(1);
  expect(purchases[0]).toMatchObject({
    id: declined!.id,
    status: "paid",
    fedapay_transaction_id: declined!.fedapay_transaction_id,
  });
});

test("a canceled payment shows not paid", async ({ page }) => {
  const { organizationId } = await ownerOnBillingPage(page, "Carole Annule");
  await pay(page, INDEPENDANT_1M);
  await page.getByRole("button", { name: "Annuler" }).click();
  await page.waitForURL(RETURN_PAGE);
  await expect(page.getByText(/^Le paiement n'a pas abouti\./)).toBeVisible();
  const [purchase] = await purchasesOf(organizationId);
  expect(purchase).toMatchObject({ status: "pending", fedapay_status: "canceled" });
});

test("when the webhook never comes, the return page grants", async ({ page }) => {
  const { organizationId } = await ownerOnBillingPage(page, "Sidoine Sanswebhook");
  await pay(page, INDEPENDANT_1M);
  await page.goto(`${page.url()}?webhook=skip`);
  await page.getByRole("button", { name: "Approuver" }).click();
  await page.waitForURL(RETURN_PAGE);
  await expect(page.getByText(/^Paiement reçu\. Votre offre Indépendant est active jusqu'au/)).toBeVisible();

  const [purchase] = await purchasesOf(organizationId);
  expect(purchase?.status).toBe("paid");
  expect((await mockTransaction(purchase!.fedapay_transaction_id!)).deliveries).toEqual([
    expect.objectContaining({ status: "skipped" }),
  ]);
  expect((await grantsOf(purchase!.id)).receipts).toHaveLength(1);
});

test("when the buyer never comes back, the webhook alone grants", async ({ page }) => {
  const { organizationId } = await ownerOnBillingPage(page, "Wilfried Webhook");
  await pay(page, INDEPENDANT_1M);
  // FedaPay's page posts the payment; the browser never follows the redirect.
  const answer = await page.request.post(page.url(), { form: { action: "approve" }, maxRedirects: 0 });
  expect(answer.status()).toBe(303);

  const [purchase] = await purchasesOf(organizationId);
  expect(purchase?.status).toBe("paid");
  expect((await grantsOf(purchase!.id)).entitlements).toHaveLength(1);
});

test("a webhook delivered twice, then replayed, grants once", async ({ page }) => {
  const { organizationId } = await ownerOnBillingPage(page, "Tobie Deuxfois");
  await pay(page, INDEPENDANT_1M);
  await page.goto(`${page.url()}?webhook=twice`);
  await page.getByRole("button", { name: "Approuver" }).click();
  await page.waitForURL(RETURN_PAGE);

  const [purchase] = await purchasesOf(organizationId);
  const transactionId = purchase!.fedapay_transaction_id!;
  // "Re-déclencher" in FedaPay's logs: the same event again.
  const replay = await fetch(`${MOCK}/__mock/transactions/${transactionId}/webhook?replay=1`, {
    method: "POST",
  });
  expect(replay.ok).toBe(true);

  const { deliveries } = await mockTransaction(transactionId);
  expect(deliveries).toHaveLength(3);
  expect(new Set(deliveries.map((delivery) => delivery.eventId)).size).toBe(1);
  expect(deliveries.map((delivery) => delivery.status)).toEqual([200, 200, 200]);
  const { entitlements, receipts } = await grantsOf(purchase!.id);
  expect(entitlements).toHaveLength(1);
  expect(receipts).toHaveLength(1);
});

test("a payment for another amount goes to review and grants nothing", async ({ page }) => {
  const { organizationId } = await ownerOnBillingPage(page, "Rosine Revue");
  await pay(page, CABINET_1M);
  await page.goto(`${page.url()}?amount=1000`);
  await page.getByRole("button", { name: "Approuver" }).click();
  await page.waitForURL(RETURN_PAGE);
  await expect(
    page.getByText(
      "Ce paiement est en cours de vérification par notre équipe. L'offre sera activée une fois la vérification faite.",
    ),
  ).toBeVisible();

  const [purchase] = await purchasesOf(organizationId);
  expect(purchase).toMatchObject({ status: "review", review_reason: "amount", amount_xof: 49_000 });
  expect(await grantsOf(purchase!.id)).toEqual({ entitlements: [], receipts: [] });

  // No new purchase until the operator has looked.
  await page.goto(`/fr/organisations/${organizationId}/abonnement`);
  await page.getByRole("button", { name: INDEPENDANT_1M }).click();
  await expect(
    page.getByText(
      "Un paiement de cette organisation est en cours de vérification. Écrivez au support avant d'en lancer un autre.",
    ),
  ).toBeVisible();
});

test("a return URL carrying another paid transaction pays nothing", async ({ page }) => {
  const { organizationId } = await ownerOnBillingPage(page, "Tanguy Triche");
  // A first purchase, paid: its transaction is approved at FedaPay.
  await pay(page, INDEPENDANT_1M);
  await page.getByRole("button", { name: "Approuver" }).click();
  await page.waitForURL(RETURN_PAGE);
  const [paid] = await purchasesOf(organizationId);

  // A second one, left on FedaPay's page.
  await page.goto(`/fr/organisations/${organizationId}/abonnement`);
  await pay(page, CABINET_1M);
  const pending = (await purchasesOf(organizationId)).find((purchase) => purchase.offer === "cabinet_1m");
  expect(pending?.status).toBe("pending");

  await page.goto(
    `/fr/organisations/${organizationId}/abonnement/retour/${pending!.id}?id=${paid!.fedapay_transaction_id}&status=approved`,
  );
  await expect(page.getByText(/^Paiement en attente de confirmation\./)).toBeVisible();
  const after = (await purchasesOf(organizationId)).find((purchase) => purchase.id === pending!.id);
  expect(after).toMatchObject({ status: "pending", fedapay_status: "pending" });
  expect(after?.fedapay_transaction_id).not.toBe(paid!.fedapay_transaction_id);
  expect((await grantsOf(pending!.id)).entitlements).toHaveLength(0);
});

test("grants applied at the same moment get receipt numbers that follow each other", async () => {
  // Four organizations paid at once through four database connections: each
  // grant takes the receipt counter in turn, so the numbers are distinct
  // and leave no gap.
  const admin = adminClient();
  const owners: TestUser[] = await Promise.all(
    ["Una", "Deo", "Tia", "Kwa"].map((name) => createTestUser(`${name} Parallele`)),
  );
  const purchases = await Promise.all(
    owners.map(async (owner, index) => {
      const { organization_id: organizationId } = await createWorkspaceFor(owner, `Parallele ${index}`);
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
          p_created_by: owner.id,
          p_reuse: false,
        })
        .single();
      if (error || !data?.purchase_id) throw error ?? new Error("no purchase");
      // Far from the mock's own ids.
      const transactionId = 9_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
      const linked = await admin.rpc("billing_set_transaction", {
        p_purchase_id: data.purchase_id,
        p_transaction_id: transactionId,
      });
      if (linked.error) throw linked.error;
      return { id: data.purchase_id, reference: data.merchant_reference, transactionId };
    }),
  );

  const results = await Promise.all(
    purchases.map((purchase) =>
      admin
        .rpc("billing_apply_transaction", {
          p_purchase_id: purchase.id,
          p_source: "reconcile",
          p_transaction_id: purchase.transactionId,
          p_status: "approved",
          p_amount_xof: 15_000,
          p_environment: "mock",
          p_currency: "XOF",
          p_merchant_reference: purchase.reference,
        })
        .single(),
    ),
  );
  for (const result of results) {
    expect(result.error).toBeNull();
    expect(result.data?.outcome).toBe("granted");
  }
  const numbers = results.map((result) => Number(result.data!.receipt_number.slice(8))).sort((a, b) => a - b);
  expect(new Set(numbers).size).toBe(4);
  expect(numbers[3]! - numbers[0]!).toBe(3);
});
