import { expect, test, type Page } from "@playwright/test";
import { adminClient, createTestUser, createWorkspaceFor, signedInClient, type TestUser } from "./supabase";

// KRB-19: the dashboard follows section changes made in another session,
// through Supabase Realtime, and Realtime only tells members about them.
// Needs the Realtime container, which CI starts with the local stack.
test.describe.configure({ mode: "serial" });

type Setup = {
  owner: TestUser;
  expert: TestUser;
  outsider: TestUser;
  workspaceId: string;
  reportTitle: string;
  ids: { mine: string; done: string };
};

let setup: Setup;

test.beforeAll(async () => {
  const [owner, expert, outsider] = await Promise.all([
    createTestUser("Odile Owner"),
    createTestUser("Elie Expert"),
    createTestUser("Omar Outsider"),
  ]);
  const { workspace_id: workspaceId, report_id: reportId } = await createWorkspaceFor(owner, "Suivi Parakou");
  await createWorkspaceFor(outsider, "Autre Cabinet");

  const admin = adminClient();
  const { error: memberError } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: expert.id, role: "expert" });
  if (memberError) throw memberError;

  // Same weight, one section done: the report starts at 50 %.
  const base = { workspace_id: workspaceId, report_id: reportId, weight: 1 };
  const { data: sections, error } = await admin
    .from("report_sections")
    .insert([
      {
        ...base,
        title: "Analyse terrain",
        position: 0,
        status: "not_started" as const,
        assigned_to: expert.id,
      },
      { ...base, title: "Synthèse", position: 1, status: "completed" as const, assigned_to: null },
    ])
    .select("id, title");
  if (error || !sections) throw error ?? new Error("Could not create the sections");
  const id = (title: string) => {
    const section = sections.find((row) => row.title === title);
    if (!section) throw new Error(`Missing section ${title}`);
    return section.id;
  };

  setup = {
    owner,
    expert,
    outsider,
    workspaceId,
    reportTitle: "Rapport Suivi Parakou",
    ids: { mine: id("Analyse terrain"), done: id("Synthèse") },
  };
});

/** Realtime confirms a postgres_changes subscription with this system message. */
function isSubscribedToPostgres(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return false;
  const message = payload as { extension?: unknown; status?: unknown };
  return message.extension === "postgres_changes" && message.status === "ok";
}

/** Listens to the workspace's section changes as `user`, like the dashboard does. */
async function listen(user: TestUser) {
  const api = await signedInClient(user);
  const { data } = await api.auth.getSession();
  if (!data.session) throw new Error("No session");
  api.realtime.setAuth(data.session.access_token);

  const events: string[] = [];
  const channel = api.channel(`e2e-dashboard-${user.id}`);
  await new Promise<void>((resolve, reject) => {
    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "report_sections",
          filter: `workspace_id=eq.${setup.workspaceId}`,
        },
        (change) => events.push(change.eventType),
      )
      .on("system", {}, (payload) => {
        if (isSubscribedToPostgres(payload)) resolve();
      })
      .subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(err ?? new Error(status));
      });
  });
  return {
    events,
    close: () => api.removeChannel(channel),
  };
}

async function setStatus(sectionId: string, status: "not_started" | "in_progress" | "completed") {
  const { error } = await adminClient().from("report_sections").update({ status }).eq("id", sectionId);
  if (error) throw error;
}

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

/** Resolves once the page's Realtime channel listens to Postgres changes. */
function realtimeReady(page: Page) {
  return new Promise<void>((resolve) => {
    page.on("websocket", (socket) => {
      if (!socket.url().includes("/realtime/v1/")) return;
      socket.on("framereceived", ({ payload }) => {
        if (typeof payload !== "string" || !payload.includes('"postgres_changes"')) return;
        try {
          const frame = JSON.parse(payload) as { event?: string; payload?: unknown };
          if (frame.event === "system" && isSubscribedToPostgres(frame.payload)) resolve();
        } catch {
          // Not JSON: not the message we wait for.
        }
      });
    });
  });
}

test("Realtime tells members about a section change and tells outsiders nothing", async () => {
  const [member, outsider] = await Promise.all([listen(setup.expert), listen(setup.outsider)]);
  try {
    await setStatus(setup.ids.done, "in_progress");
    // Realtime may also pass on the inserts of the setup, read late from the WAL.
    await expect.poll(() => member.events, { timeout: 5_000 }).toContain("UPDATE");
    // The member heard it: had the outsider been sent anything, it would be here by now.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(outsider.events).toEqual([]);
  } finally {
    await setStatus(setup.ids.done, "completed");
    await Promise.all([member.close(), outsider.close()]);
  }
});

test("the owner's dashboard follows the expert's status change without a reload", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const expertContext = await browser.newContext();
  try {
    const dashboard = await ownerContext.newPage();
    await signIn(dashboard, setup.owner);
    const ready = realtimeReady(dashboard);
    await dashboard.goto("/fr/tableau-de-bord");

    const progress = dashboard.getByRole("progressbar", { name: new RegExp(setup.reportTitle) });
    await expect(progress).toHaveAttribute("aria-valuenow", "50");
    await ready;

    const section = await expertContext.newPage();
    await signIn(section, setup.expert);
    await section.goto(`/fr/espaces/${setup.workspaceId}/sections/${setup.ids.mine}`);
    await section.getByLabel("Statut de la section").selectOption({ label: "Terminée" });
    await expect(section.getByLabel("Statut de la section")).toHaveValue("completed");

    // The story asks for 2 s on a normal connection; CI machines get some slack.
    await expect(progress).toHaveAttribute("aria-valuenow", "100", { timeout: 5_000 });
  } finally {
    await Promise.all([ownerContext.close(), expertContext.close()]);
  }
});
