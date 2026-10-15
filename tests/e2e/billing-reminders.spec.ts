import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { clearInbox, subjectsFor, waitForLink } from "./mailpit";
import { adminClient, createTestUser, createWorkspaceFor, signedInClient, type TestUser } from "./supabase";

// KRB-178: renewal reminders, expiry and read-only (ADR 001, sections 6, 7.3
// and 17). The test makes its own organization and moves the dates of its
// trial with the service role, then runs the daily job by hand: each
// reminder reaches the owner once, even when the job runs twice at the same
// time, and the banner and the pages follow the state. Billing is enforced
// locally and in CI (supabase/seed.sql), and the job needs CRON_SECRET in
// .env.local (CI writes one).
//
// The job is global: it also sends the reminders other organizations of the
// database owe. Mailpit is shared, so every check filters by recipient.
test.describe.configure({ mode: "serial" });

const CRON_PATH = "/api/cron/billing";
const DAY_MS = 24 * 60 * 60 * 1000;

const SUBJECTS = {
  d7: "Votre offre KolabReport se termine dans 5 jours",
  d1: "Votre offre KolabReport se termine demain",
  ended: "Votre offre KolabReport est terminée",
  readOnly: "Votre espace KolabReport est en lecture seule",
};

type Setup = {
  owner: TestUser;
  expert: TestUser;
  organizationId: string;
  workspaceId: string;
  reportId: string;
  sectionId: string;
  trialId: string;
  enforced: boolean;
};

let setup: Setup;

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

/** "8 octobre 2026", in Benin time, like the app. */
function frenchDate(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Africa/Porto-Novo" }).format(date);
}

/** Noon in Porto-Novo (11:00 UTC), `days` calendar days from today there. */
function noonInDays(days: number) {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Porto-Novo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .split("-")
    .map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days, 11, 0, 0));
}

/** Moves the end of the test organization's trial. Only rows this file made. */
async function endTrialAt(endsAt: Date) {
  const { error } = await adminClient()
    .from("billing_entitlements")
    .update({
      starts_at: new Date(Math.min(endsAt.getTime(), Date.now()) - 14 * DAY_MS).toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .eq("id", setup.trialId)
    .eq("organization_id", setup.organizationId);
  if (error) throw error;
}

async function runCron(request: APIRequestContext) {
  const response = await request.get(CRON_PATH, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  const body = (await response.json()) as {
    ok: boolean;
    steps: { notices: { ok: boolean; notices: number; emailsSent: number }; reconcile: { ok: boolean } };
  };
  // The reminders step must pass. The reconciliation step reads every
  // pending purchase of the database, other specs' included, so its result
  // is not this spec's to judge: the route answers 500 when it fails.
  expect(Object.keys(body.steps), JSON.stringify(body)).toEqual(["notices", "reconcile"]);
  expect(body.steps.notices.ok, JSON.stringify(body)).toBe(true);
  expect(response.status()).toBe(body.ok ? 200 : 500);
  // Counts only: no address, no name.
  expect(JSON.stringify(body)).not.toContain("@");
  return body;
}

/** How many e-mails `to` received with each subject. */
async function countSubjects(to: string) {
  const subjects = await subjectsFor(to);
  return Object.fromEntries(
    Object.entries(SUBJECTS).map(([kind, subject]) => [kind, subjects.filter((s) => s === subject).length]),
  );
}

function banner(page: Page) {
  return page.getByRole("complementary", { name: "Abonnement" });
}

test.beforeAll(async () => {
  const [owner, expert] = await Promise.all([
    createTestUser("Rosine Rappel"),
    createTestUser("Edgar Lecture"),
  ]);
  const {
    api,
    organization_id: organizationId,
    workspace_id: workspaceId,
    report_id: reportId,
  } = await createWorkspaceFor(owner, "Rappels Lokossa");
  const admin = adminClient();
  const { error: memberError } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: expert.id, role: "expert" });
  if (memberError) throw memberError;
  const { data: section, error: sectionError } = await admin
    .from("report_sections")
    .insert({ workspace_id: workspaceId, report_id: reportId, title: "Constats", assigned_to: expert.id })
    .select("id")
    .single();
  if (sectionError || !section) throw sectionError ?? new Error("Could not add the section");
  const { data: trial, error: trialError } = await admin
    .from("billing_entitlements")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("plan", "trial")
    .single();
  if (trialError || !trial) throw trialError ?? new Error("No trial");
  const { data: state } = await api.rpc("workspace_billing_state", { p_workspace_id: workspaceId }).single();

  await Promise.all([clearInbox(owner.email), clearInbox(expert.email)]);
  setup = {
    owner,
    expert,
    organizationId,
    workspaceId,
    reportId,
    sectionId: section.id,
    trialId: trial.id,
    enforced: state?.state === "trialing",
  };
});

test.beforeEach(() => {
  test.skip(!setup.enforced, "Billing is not enforced on this database (supabase/seed.sql turns it on)");
  test.skip(!process.env.CRON_SECRET, "Needs CRON_SECRET in .env.local (CI writes one)");
});

test("the owner sees the days left in the trial, with a link to choose an offer", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto("/fr/tableau-de-bord");

  await expect(banner(page)).toContainText(/^Essai gratuit : encore 1[34] jours\./);
  const choose = banner(page).getByRole("link", { name: "Choisir une offre" });
  await expect(choose).toHaveAttribute("href", `/fr/organisations/${setup.organizationId}/abonnement`);

  // The link opens the organization's billing page (KRB-176).
  await choose.click();
  await expect(page).toHaveURL(`/fr/organisations/${setup.organizationId}/abonnement`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Abonnement de Cabinet Rappels Lokossa" }),
  ).toBeVisible();
});

test("experts get no trial banner: they cannot renew", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto("/fr/tableau-de-bord");

  await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test("each reminder reaches the owner once, even when the job runs twice at the same time", async ({
  request,
}) => {
  const { owner, expert, organizationId } = setup;

  // 7 days before: the trial ends at noon in 5 days, so d7 is due now.
  await endTrialAt(noonInDays(5));
  await Promise.all([runCron(request), runCron(request)]);
  expect(await countSubjects(owner.email)).toEqual({ d7: 1, d1: 0, ended: 0, readOnly: 0 });
  await runCron(request);
  expect(await countSubjects(owner.email)).toEqual({ d7: 1, d1: 0, ended: 0, readOnly: 0 });
  const link = await waitForLink(owner.email, SUBJECTS.d7, /href="([^"]*\/abonnement)"/);
  expect(new URL(link).pathname).toBe(`/fr/organisations/${organizationId}/abonnement`);

  // The day before.
  await endTrialAt(noonInDays(1));
  await runCron(request);
  expect(await countSubjects(owner.email)).toEqual({ d7: 1, d1: 1, ended: 0, readOnly: 0 });

  // Ended yesterday: the grace starts.
  await endTrialAt(new Date(Date.now() - DAY_MS));
  await runCron(request);
  expect(await countSubjects(owner.email)).toEqual({ d7: 1, d1: 1, ended: 1, readOnly: 0 });

  // Eight days ago: the grace is over.
  await endTrialAt(new Date(Date.now() - 8 * DAY_MS));
  await Promise.all([runCron(request), runCron(request)]);
  await runCron(request);
  expect(await countSubjects(owner.email)).toEqual({ d7: 1, d1: 1, ended: 1, readOnly: 1 });

  // Experts cannot renew: no reminder for them.
  expect(await subjectsFor(expert.email)).toEqual([]);
});

test("the owner finds the four reminders in the notifications, each linking to the billing page", async ({
  page,
}) => {
  await signIn(page, setup.owner);
  await page.goto("/fr/notifications");

  const items = page.getByRole("main").getByRole("listitem");
  await expect(items).toHaveCount(4);
  for (const item of await items.all()) {
    await expect(item.getByRole("link")).toHaveAttribute(
      "href",
      `/fr/organisations/${setup.organizationId}/abonnement`,
    );
  }
  await expect(page.getByRole("main")).toContainText(
    /Lecture seule depuis le .+ pour les espaces de Cabinet Rappels Lokossa/,
  );
});

test("in grace, every member sees until when, and who can renew", async ({ page }) => {
  const endsAt = new Date(Date.now() - DAY_MS);
  await endTrialAt(endsAt);
  const graceEnd = new Date(endsAt.getTime() + 7 * DAY_MS);

  await signIn(page, setup.expert);
  await page.goto("/fr/tableau-de-bord");
  await expect(banner(page)).toContainText(
    `Votre essai gratuit est terminé depuis le ${frenchDate(endsAt)}. Tout reste accessible jusqu'au ${frenchDate(graceEnd)}`,
  );
  await expect(banner(page)).toContainText("Pour renouveler, adressez-vous à Rosine Rappel.");
  await expect(banner(page).getByRole("link")).toHaveCount(0);
});

test("read-only: the owner reads and exports, edits are disabled with the reason", async ({ page }) => {
  const endsAt = new Date(Date.now() - 8 * DAY_MS);
  await endTrialAt(endsAt);
  const since = frenchDate(new Date(endsAt.getTime() + 7 * DAY_MS));

  await signIn(page, setup.owner);
  await page.goto("/fr/tableau-de-bord");
  await expect(banner(page)).toContainText(
    `Lecture seule depuis le ${since} : consultation et export uniquement.`,
  );
  await expect(banner(page).getByRole("link", { name: "Renouveler l'offre" })).toBeVisible();
  const main = page.getByRole("main");
  const newReport = main.getByRole("button", { name: "Nouveau rapport" });
  await expect(newReport).toBeDisabled();
  await expect(newReport).toHaveAccessibleDescription(
    "Indisponible : l'espace de travail est en lecture seule.",
  );

  await page.goto(`/fr/rapports/${setup.reportId}`);
  await expect(main).toContainText(`Cet espace de travail est en lecture seule depuis le ${since}.`);
  const submit = main.getByRole("button", { name: "Soumettre pour revue" });
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAccessibleDescription(
    "Indisponible : l'espace de travail est en lecture seule.",
  );
  await expect(main.getByRole("textbox", { name: "Nouvelle section" })).toHaveCount(0);

  // Exports stay open. Producing the file needs the Storage container (CI).
  const pdf = main.getByRole("button", { name: "Exporter en PDF" });
  await expect(pdf).toBeEnabled();
  const { error: storageError } = await adminClient().storage.getBucket("exports");
  if (!storageError) {
    const downloading = page.waitForEvent("download");
    await pdf.click();
    expect((await downloading).suggestedFilename()).toMatch(/\.pdf$/);
  }

  await page.goto(`/fr/espaces/${setup.workspaceId}/membres`);
  await expect(main.getByRole("button", { name: "Envoyer l'invitation" })).toBeDisabled();
});

test("read-only: the database refuses writes in a user's name, and deletes still work", async () => {
  await endTrialAt(new Date(Date.now() - 8 * DAY_MS));
  const [owner, expert] = await Promise.all([signedInClient(setup.owner), signedInClient(setup.expert)]);

  const { error: renameError } = await owner
    .from("reports")
    .update({ title: "Renommé en lecture seule" })
    .eq("id", setup.reportId);
  expect(renameError?.code).toBe("KR043");

  const { data: section } = await expert
    .from("report_sections")
    .select("content_updated_at")
    .eq("id", setup.sectionId)
    .single();
  const { error: saveError } = await expert.rpc("save_section_content", {
    p_section_id: setup.sectionId,
    p_content: "Texte refusé",
    p_expected_version: section!.content_updated_at,
  });
  expect(saveError?.code).toBe("KR043");

  const { data: added } = await adminClient()
    .from("report_sections")
    .insert({ workspace_id: setup.workspaceId, report_id: setup.reportId, title: "À supprimer" })
    .select("id")
    .single();
  const { data: deleted, error: deleteError } = await owner
    .from("report_sections")
    .delete()
    .eq("id", added!.id)
    .select("id");
  expect(deleteError).toBeNull();
  expect(deleted).toHaveLength(1);
});

test("read-only: the expert reads the section and is told who can renew", async ({ page }) => {
  const endsAt = new Date(Date.now() - 8 * DAY_MS);
  await endTrialAt(endsAt);
  const since = frenchDate(new Date(endsAt.getTime() + 7 * DAY_MS));

  await signIn(page, setup.expert);
  await page.goto(`/fr/espaces/${setup.workspaceId}/sections/${setup.sectionId}`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Constats" })).toBeVisible();
  await expect(main).toContainText(
    `Cet espace de travail est en lecture seule depuis le ${since}. Demandez au propriétaire de l'organisation de renouveler l'offre.`,
  );
  await expect(main.getByRole("button", { name: "Enregistrer" })).toHaveCount(0);
  await expect(banner(page)).toContainText("Pour renouveler, adressez-vous à Rosine Rappel.");
});
