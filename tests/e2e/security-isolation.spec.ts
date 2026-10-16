import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adminClient,
  anonClient,
  createTestUser,
  createWorkspaceFor,
  signedInClient,
  type TestUser,
} from "./supabase";

// KRB-146 (part of KRB-24): workspace isolation through the API, as the
// browser reaches it. A manager of workspace B, a viewer of workspace A and
// a signed-out visitor must not read or change anything of A beyond what
// their role allows. Every check first makes sure A really has the rows, so
// an empty answer means "hidden", not "nothing there". pgTAP covers the same
// rules role by role in SQL; these tests go through PostgREST, Realtime and
// Storage. Storage only runs in CI.

type Ids = { organizationId: string; workspaceId: string };

type Setup = {
  owner: TestUser;
  viewer: TestUser;
  attacker: TestUser;
  a: Ids & { reportId: string; sectionId: string; deliverableId: string; generationId: string };
  b: Ids;
};

let setup: Setup;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test.beforeAll(async () => {
  const [owner, expert, viewer, attacker] = await Promise.all([
    createTestUser("Awa Owner"),
    createTestUser("Eloi Expert"),
    createTestUser("Vera Viewer"),
    createTestUser("Ali Attacker"),
  ]);
  const a = await createWorkspaceFor(owner, "Cabinet Cotonou");
  const b = await createWorkspaceFor(attacker, "Cabinet Intrus");
  const admin = adminClient();

  const { error: membersError } = await admin.from("workspace_members").insert([
    { workspace_id: a.workspace_id, user_id: expert.id, role: "expert" },
    { workspace_id: a.workspace_id, user_id: viewer.id, role: "viewer" },
  ]);
  if (membersError) throw membersError;

  // One row of A in every table the checks read.
  const { data: section, error: sectionError } = await admin
    .from("report_sections")
    .insert({
      workspace_id: a.workspace_id,
      report_id: a.report_id,
      title: "Diagnostic",
      status: "in_progress",
      assigned_to: expert.id,
      content: "Texte confidentiel de A.",
    })
    .select("id, content_updated_at")
    .single();
  if (sectionError || !section) throw sectionError ?? new Error("No section");

  const deliverablePath = `${a.workspace_id}/${section.id}/isolation.docx`;
  const { data: deliverable, error: deliverableError } = await admin
    .from("deliverables")
    .insert({
      workspace_id: a.workspace_id,
      section_id: section.id,
      uploaded_by: expert.id,
      storage_path: deliverablePath,
      file_name: "isolation.docx",
      mime_type: DOCX,
      size_bytes: 10,
    })
    .select("id")
    .single();
  if (deliverableError || !deliverable) throw deliverableError ?? new Error("No deliverable");

  const { data: prompt, error: promptError } = await admin
    .from("prompt_library")
    .insert({
      workspace_id: a.workspace_id,
      template_key: "isolation",
      version: 1,
      title: "Modèle de A",
      template: "Rédige la section {{section_title}}.",
      status: "published",
      output_schema: "section_draft",
    })
    .select("id")
    .single();
  if (promptError || !prompt) throw promptError ?? new Error("No prompt");

  const { data: generation, error: generationError } = await admin
    .from("ai_generations")
    .insert({
      workspace_id: a.workspace_id,
      section_id: section.id,
      requested_by: expert.id,
      prompt_version_id: prompt.id,
      output_schema: "section_draft",
      schema_version: 1,
      provider: "mock",
      model: "mock",
      estimated_tokens: 100,
      status: "succeeded",
      output: { content: "Brouillon de A" },
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (generationError || !generation) throw generationError ?? new Error("No generation");

  const { error: exportError } = await admin.from("report_exports").insert({
    workspace_id: a.workspace_id,
    report_id: a.report_id,
    format: "pdf",
    file_name: "rapport-a.pdf",
    created_by: owner.id,
  });
  if (exportError) throw exportError;

  const { error: invitationError } = await admin.from("workspace_invitations").insert({
    workspace_id: a.workspace_id,
    email: "invite-a@kolabreport.test",
    role: "expert",
    token_hash: randomBytes(32).toString("hex"),
    invited_by: owner.id,
  });
  if (invitationError) throw invitationError;

  // An AI reading of a PDF plan by A's owner (KRB-196), as the server records it.
  const { error: planError } = await admin.from("plan_import_calls").insert({
    workspace_id: a.workspace_id,
    report_id: a.report_id,
    user_id: owner.id,
    provider: "mock",
    model: "mock",
    input_chars: 1200,
    pages: 2,
    status: "succeeded",
    items: 6,
    completed_at: new Date().toISOString(),
  });
  if (planError) throw planError;

  // A status change writes the history and notifies the expert and the viewer's managers.
  const { error: transitionError } = await a.api.rpc("transition_report_status", {
    p_report_id: a.report_id,
    p_from: "draft",
    p_to: "in_review",
  });
  if (transitionError) throw transitionError;

  setup = {
    owner,
    viewer,
    attacker,
    a: {
      organizationId: a.organization_id,
      workspaceId: a.workspace_id,
      reportId: a.report_id,
      sectionId: section.id,
      deliverableId: deliverable.id,
      generationId: generation.id,
    },
    b: { organizationId: b.organization_id, workspaceId: b.workspace_id },
  };
});

/** The same client without table types, to loop over table names. */
function untyped(client: unknown) {
  return client as SupabaseClient;
}

/** Tables and views with a workspace_id. */
const WORKSPACE_TABLES = [
  "workspace_members",
  "workspace_invitations",
  "reports",
  "report_sections",
  "report_progress",
  "deliverables",
  "prompt_library",
  "ai_generations",
  "report_exports",
  "plan_import_calls",
  "report_status_events",
  "notifications",
] as const;

test("a manager of B reads none of A's rows, in any table", async () => {
  const { attacker, a } = setup;
  const api = untyped(await signedInClient(attacker));
  const admin = untyped(adminClient());

  for (const table of WORKSPACE_TABLES) {
    const { count } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", a.workspaceId);
    expect(count, `A has rows in ${table}`).toBeGreaterThan(0);

    const { data, error } = await api.from(table).select("*").eq("workspace_id", a.workspaceId);
    expect(error, `reading ${table}`).toBeNull();
    expect(data, `rows of A seen by B in ${table}`).toEqual([]);
  }

  for (const [table, id] of [
    ["organizations", a.organizationId],
    ["workspaces", a.workspaceId],
  ] as const) {
    const { data } = await api.from(table).select("id").eq("id", id);
    expect(data, `${table} of A seen by B`).toEqual([]);
  }
  const { data: profile } = await api.from("profiles").select("id").eq("id", setup.owner.id);
  expect(profile, "A's owner profile seen by B").toEqual([]);
});

test("a signed-out visitor cannot read any table", async () => {
  const anon = untyped(anonClient());
  for (const table of [
    ...WORKSPACE_TABLES,
    "organizations",
    "workspaces",
    "profiles",
    "prompt_rollouts",
  ] as const) {
    const { data, error } = await anon.from(table).select("*").limit(1);
    expect(data ?? [], `anon rows in ${table}`).toEqual([]);
    expect(error?.code, `anon error on ${table}`).toBe("42501");
  }
});

test("a manager of B changes nothing of A, directly or through the functions", async () => {
  const { attacker, a } = setup;
  const api = await signedInClient(attacker);
  const admin = adminClient();
  const before = await admin
    .from("report_sections")
    .select("title, content, status")
    .eq("id", a.sectionId)
    .single();

  const { data: renamed } = await api
    .from("reports")
    .update({ title: "Pris" })
    .eq("id", a.reportId)
    .select("id");
  expect(renamed).toEqual([]);
  const { data: changed } = await api
    .from("report_sections")
    .update({ title: "Pris", status: "completed" })
    .eq("id", a.sectionId)
    .select("id");
  expect(changed).toEqual([]);
  // Sections are deleted through delete_report_section only (KRB-195).
  const { error: removed } = await api.from("report_sections").delete().eq("id", a.sectionId);
  expect(removed?.code).toBe("42501");
  const { error: added } = await api
    .from("report_sections")
    .insert({ workspace_id: a.workspaceId, report_id: a.reportId, title: "Ajout" });
  expect(added?.code).toBe("42501");
  const { data: fileGone } = await api.from("deliverables").delete().eq("id", a.deliverableId).select("id");
  expect(fileGone).toEqual([]);

  const calls = [
    api.rpc("save_section_content", {
      p_section_id: a.sectionId,
      p_content: "Écrasé",
      p_expected_version: new Date().toISOString(),
    }),
    api.rpc("reorder_report_sections", { p_report_id: a.reportId, p_section_ids: [a.sectionId] }),
    api.rpc("delete_report_section", { p_section_id: a.sectionId }),
    api.rpc("transition_report_status", { p_report_id: a.reportId, p_from: "in_review", p_to: "draft" }),
    api.rpc("accept_ai_generation", {
      p_generation_id: a.generationId,
      p_content: "Écrasé",
      p_edit_distance: 0,
      p_section_updated_at: new Date().toISOString(),
    }),
    api.rpc("discard_ai_generation", { p_generation_id: a.generationId }),
  ];
  for (const [index, result] of (await Promise.all(calls)).entries()) {
    expect(result.error, `function call ${index}`).not.toBeNull();
  }

  const after = await admin
    .from("report_sections")
    .select("title, content, status")
    .eq("id", a.sectionId)
    .single();
  expect(after.data).toEqual(before.data);
  const { data: report } = await admin.from("reports").select("title, status").eq("id", a.reportId).single();
  expect(report?.status).toBe("in_review");
  expect(report?.title).not.toBe("Pris");
});

test("a viewer of A reads A but changes nothing", async () => {
  const { viewer, a } = setup;
  const api = await signedInClient(viewer);

  const { data: sections } = await api.from("report_sections").select("id").eq("id", a.sectionId);
  expect(sections).toHaveLength(1);

  const { data: changed } = await api
    .from("report_sections")
    .update({ status: "completed" })
    .eq("id", a.sectionId)
    .select("id");
  expect(changed).toEqual([]);
  const { error: transition } = await api.rpc("transition_report_status", {
    p_report_id: a.reportId,
    p_from: "in_review",
    p_to: "draft",
  });
  expect(transition?.code).toBe("42501");
  const { error: invite } = await api.from("workspace_invitations").insert({
    workspace_id: a.workspaceId,
    email: "intrus@kolabreport.test",
    role: "admin",
    token_hash: randomBytes(32).toString("hex"),
  });
  expect(invite?.code).toBe("42501");
  const { error: generation } = await api.rpc("start_ai_generation", {
    p_workspace_id: a.workspaceId,
    p_section_id: a.sectionId,
    p_user_id: viewer.id,
    p_prompt_version_id: a.generationId,
    p_output_schema: "section_draft",
    p_schema_version: 1,
    p_provider: "mock",
    p_model: "mock",
    p_params: {},
    p_estimated_tokens: 1,
    p_rate_limit: 100,
    p_monthly_budget: 1_000_000,
  });
  // Service-role only: signed-in users cannot even call it.
  expect(generation).not.toBeNull();
});

test("a manager of B hears nothing of A's sections through Realtime", async () => {
  const { attacker, a } = setup;
  const api = await signedInClient(attacker);
  const { data } = await api.auth.getSession();
  if (!data.session) throw new Error("No session");
  api.realtime.setAuth(data.session.access_token);

  const events: string[] = [];
  const channel = api.channel(`isolation-${attacker.id}`);
  // Realtime either refuses the subscription or accepts it and sends nothing.
  const outcome = await new Promise<"ok" | "refused">((resolve, reject) => {
    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "report_sections", filter: `report_id=eq.${a.reportId}` },
        (change) => events.push(change.eventType),
      )
      .on("system", {}, (payload: { extension?: string; status?: string }) => {
        if (payload.extension === "postgres_changes") resolve(payload.status === "ok" ? "ok" : "refused");
      })
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(error ?? new Error(status));
      });
  });
  try {
    if (outcome === "ok") {
      await adminClient()
        .from("report_sections")
        .update({ title: "Diagnostic mis à jour" })
        .eq("id", a.sectionId);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    expect(events).toEqual([]);
  } finally {
    await api.removeChannel(channel);
  }
});

test("Storage keeps A's files from a manager of B and from visitors", async () => {
  const storageUp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/status`)
    .then((response) => response.ok)
    .catch(() => false);
  test.skip(!storageUp, "Storage only runs in CI");

  const { attacker, a } = setup;
  const admin = adminClient();
  const path = `${a.workspaceId}/${a.sectionId}/isolation.docx`;
  const { error: uploadError } = await admin.storage
    .from("deliverables")
    .upload(path, new Blob(["contenu de A"], { type: DOCX }), { contentType: DOCX, upsert: true });
  if (uploadError) throw uploadError;

  for (const client of [await signedInClient(attacker), anonClient()]) {
    const bucket = client.storage.from("deliverables");
    const { data: file } = await bucket.download(path);
    expect(file).toBeNull();
    const { data: link } = await bucket.createSignedUrl(path, 60);
    expect(link).toBeNull();
    const { data: listed } = await bucket.list(`${a.workspaceId}/${a.sectionId}`);
    expect(listed ?? []).toEqual([]);
    const { error: overwrite } = await bucket.upload(`${a.workspaceId}/${a.sectionId}/intrus.docx`, "x", {
      contentType: DOCX,
    });
    expect(overwrite).not.toBeNull();
  }
  const { data: still } = await admin.storage.from("deliverables").download(path);
  expect(still).not.toBeNull();
});

test("a manager of B cannot move B into A's organization and read it", async () => {
  const { attacker, a, b } = setup;
  const api = await signedInClient(attacker);

  await api.from("workspaces").update({ organization_id: a.organizationId }).eq("id", b.workspaceId);

  try {
    const { data: moved } = await adminClient()
      .from("workspaces")
      .select("organization_id")
      .eq("id", b.workspaceId)
      .single();
    expect(moved?.organization_id).toBe(b.organizationId);

    const { data: leaked } = await api
      .from("organizations")
      .select("id, name, owner_id")
      .eq("id", a.organizationId);
    expect(leaked).toEqual([]);
  } finally {
    // Put B back so a failed run leaves A's organization as it was.
    await adminClient()
      .from("workspaces")
      .update({ organization_id: b.organizationId })
      .eq("id", b.workspaceId);
  }
});

test("a manager of B cannot add a member of A to B without an invitation and read their profile", async () => {
  const { owner, attacker, b } = setup;
  const api = await signedInClient(attacker);

  const { error } = await api
    .from("workspace_members")
    .insert({ workspace_id: b.workspaceId, user_id: owner.id, role: "viewer" });

  try {
    expect(error?.code).toBe("42501");

    const { data: leaked } = await api.from("profiles").select("id, email, full_name").eq("id", owner.id);
    expect(leaked).toEqual([]);
  } finally {
    await adminClient()
      .from("workspace_members")
      .delete()
      .eq("workspace_id", b.workspaceId)
      .eq("user_id", owner.id);
  }
});
