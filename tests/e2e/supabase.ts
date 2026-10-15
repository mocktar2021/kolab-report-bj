import { createClient } from "@supabase/supabase-js";
import { PLANS } from "../../src/lib/billing/catalog";
import type { Database } from "../../src/lib/supabase/database.types";

// Local stack values, read from .env.local by playwright.config.ts.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

export type TestUser = { id: string; name: string; email: string; password: string };

/** Service-role client for test setup only. It bypasses RLS. */
export function adminClient() {
  if (!url || !serviceKey) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  return createClient<Database>(url, serviceKey, noSession);
}

/** Confirmed user with a unique e-mail, ready to sign in. */
export async function createTestUser(name: string): Promise<TestUser> {
  const slug = name.toLowerCase().replace(/[^a-z]+/g, "-");
  const email = `e2e-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@kolabreport.test`;
  const password = "Kolab-test-2026";
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user) throw error ?? new Error(`Could not create ${email}`);
  return { id: data.user.id, name, email, password };
}

/** Client with the anon key and no session: a signed-out visitor. */
export function anonClient() {
  if (!url || !anonKey) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient<Database>(url, anonKey, noSession);
}

/** Client signed in as `user`, subject to RLS like the browser. */
export async function signedInClient(user: TestUser) {
  if (!url || !anonKey) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const client = createClient<Database>(url, anonKey, noSession);
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
}

/** Creates an organization, a workspace and a report owned by `user`. */
export async function createWorkspaceFor(user: TestUser, workspaceName: string) {
  const api = await signedInClient(user);
  const { data, error } = await api
    .rpc("create_workspace_with_owner", {
      organization_name: `Cabinet ${workspaceName}`,
      workspace_name: workspaceName,
      report_title: `Rapport ${workspaceName}`,
    })
    .single();
  if (error || !data) throw error ?? new Error("create_workspace_with_owner returned nothing");
  return { api, ...data };
}

/**
 * Puts an organization on a plan from now on, in place of its trial, like the
 * demo organization of the seed. Billing is enforced locally and in CI, and a
 * new user's first organization only gets the trial: 1 active report and 5
 * members. Returns the new entitlement's id.
 */
export async function setPlan(organizationId: string, plan: "independant" | "cabinet") {
  const admin = adminClient();
  const now = Date.now();
  const { error: revokeError } = await admin
    .from("billing_entitlements")
    .update({ revoked_at: new Date(now).toISOString(), revoked_reason: "Test de bout en bout" })
    .eq("organization_id", organizationId)
    .eq("scope", "subscription")
    .is("revoked_at", null);
  if (revokeError) throw revokeError;
  const { limits } = PLANS[plan];
  const { data, error } = await admin
    .from("billing_entitlements")
    .insert({
      organization_id: organizationId,
      scope: "subscription",
      plan,
      source: "manual",
      starts_at: new Date(now - 60_000).toISOString(),
      ends_at: new Date(now + 30 * 86_400_000).toISOString(),
      max_members: limits.maxMembers,
      max_reports: limits.maxReports,
      drafts_per_month: limits.draftsPerMonth,
      drafts_total: limits.draftsTotal,
      custom_templates: limits.customTemplates,
      note: "Test de bout en bout",
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error(`Could not put ${organizationId} on ${plan}`);
  return data.id;
}

/**
 * A deliverable already read by the app, written straight to the table. It has
 * no stored file, so it works without the Storage container: drafts, previews
 * and deletions only need the row.
 */
export async function addParsedDeliverable(
  workspaceId: string,
  sectionId: string,
  uploadedBy: string,
  name: string,
  content: string,
) {
  const id = crypto.randomUUID();
  const { error } = await adminClient()
    .from("deliverables")
    .insert({
      id,
      workspace_id: workspaceId,
      section_id: sectionId,
      uploaded_by: uploadedBy,
      storage_path: `${workspaceId}/${sectionId}/${id}-${name}`,
      file_name: name,
      mime_type: "text/markdown",
      size_bytes: content.length,
      uploaded_at: new Date().toISOString(),
      parse_status: "parsed",
      parsed_content: content,
      parsed_at: new Date().toISOString(),
    });
  if (error) throw error;
  return id;
}
