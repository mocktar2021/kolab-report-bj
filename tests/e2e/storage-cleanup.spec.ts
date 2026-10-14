import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { adminClient, createTestUser, createWorkspaceFor } from "./supabase";

// KRB-166: deleting a report queues the files of its deliverables and
// exports, and the daily cron job removes them from Storage. The removal
// test needs the Storage container and CRON_SECRET in .env.local: CI has
// both, the local stack here may not, so it skips there. The access checks
// run everywhere.
test.describe.configure({ mode: "serial" });

const CRON_PATH = "/api/cron/storage-cleanup";

async function storageIsUp() {
  const { error } = await adminClient().storage.getBucket("exports");
  return !error;
}

/** Names of the objects stored directly under `folder`. */
async function storedNames(bucket: "deliverables" | "exports", folder: string) {
  const { data, error } = await adminClient().storage.from(bucket).list(folder);
  if (error) throw error;
  return data.map((file) => file.name);
}

test("the cron route refuses calls without the secret", async ({ request }) => {
  const missing = await request.get(CRON_PATH);
  expect(missing.status()).toBe(401);
  expect(await missing.json()).toEqual({ error: "unauthorized" });

  const wrong = await request.get(CRON_PATH, {
    headers: { Authorization: "Bearer ce-nest-pas-le-bon-secret-du-tout" },
  });
  expect(wrong.status()).toBe(401);
});

test("deleting a report removes its deliverable and export files from Storage", async ({ request }) => {
  const cronSecret = process.env.CRON_SECRET;
  test.skip(
    !process.env.CI && (!cronSecret || !(await storageIsUp())),
    "Needs the Storage container and CRON_SECRET in .env.local (CI has both)",
  );

  const owner = await createTestUser("Rose Nettoyage");
  const {
    api,
    workspace_id: workspaceId,
    report_id: reportId,
  } = await createWorkspaceFor(owner, "Nettoyage");
  const admin = adminClient();
  const { data: section, error: sectionError } = await admin
    .from("report_sections")
    .insert({ workspace_id: workspaceId, report_id: reportId, title: "Annexes" })
    .select("id")
    .single();
  if (sectionError || !section) throw sectionError ?? new Error("Could not create the section");

  // A deliverable registered three hours ago: its signed upload URL has
  // expired, so the job removes the file on its first run.
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const deliverableFolder = `${workspaceId}/${section.id}`;
  const deliverableName = `${randomUUID()}-notes.txt`;
  const notes = Buffer.from("Relevés du site, version de travail.");
  const { error: deliverableUploadError } = await admin.storage
    .from("deliverables")
    .upload(`${deliverableFolder}/${deliverableName}`, notes, { contentType: "text/plain" });
  if (deliverableUploadError) throw deliverableUploadError;
  const { error: deliverableError } = await admin.from("deliverables").insert({
    workspace_id: workspaceId,
    section_id: section.id,
    uploaded_by: owner.id,
    storage_path: `${deliverableFolder}/${deliverableName}`,
    file_name: "notes.txt",
    mime_type: "text/plain",
    size_bytes: notes.length,
    uploaded_at: threeHoursAgo,
    created_at: threeHoursAgo,
  });
  if (deliverableError) throw deliverableError;

  // An export of the report, as the export route stores it.
  const exportId = randomUUID();
  const exportFolder = `${workspaceId}/${reportId}`;
  const pdf = Buffer.from("%PDF-1.4\n% rapport de test\n%%EOF\n");
  const { error: exportUploadError } = await admin.storage
    .from("exports")
    .upload(`${exportFolder}/${exportId}.pdf`, pdf, { contentType: "application/pdf" });
  if (exportUploadError) throw exportUploadError;
  const { error: exportError } = await admin.from("report_exports").insert({
    id: exportId,
    workspace_id: workspaceId,
    report_id: reportId,
    format: "pdf",
    file_name: "rapport-nettoyage.pdf",
    status: "ready",
    storage_path: `${exportFolder}/${exportId}.pdf`,
    size_bytes: pdf.length,
    section_count: 1,
    created_by: owner.id,
    finished_at: new Date().toISOString(),
  });
  if (exportError) throw exportError;

  expect(await storedNames("deliverables", deliverableFolder)).toEqual([deliverableName]);
  expect(await storedNames("exports", exportFolder)).toEqual([`${exportId}.pdf`]);

  // The owner deletes the report, which takes its section, files and exports along.
  const { data: deleted, error: deleteError } = await api
    .from("reports")
    .delete()
    .eq("id", reportId)
    .select("id");
  expect(deleteError).toBeNull();
  expect(deleted).toHaveLength(1);

  const response = await request.get(CRON_PATH, { headers: { Authorization: `Bearer ${cronSecret}` } });
  expect(response.status()).toBe(200);
  const summary = await response.json();
  expect(summary).toMatchObject({ ok: true, failed: 0, timedOut: false });
  expect(summary.removed).toBeGreaterThanOrEqual(2);
  // Counts only: no path, so no workspace id.
  expect(JSON.stringify(summary)).not.toContain(workspaceId);

  expect(await storedNames("deliverables", deliverableFolder)).toEqual([]);
  expect(await storedNames("exports", exportFolder)).toEqual([]);
});
