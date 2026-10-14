import { createClient } from "@supabase/supabase-js";
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
