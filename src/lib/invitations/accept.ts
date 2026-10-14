import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Joins every workspace the signed-in user was invited to (open invitations
 * sent to their confirmed e-mail). Called right after sign-in and e-mail
 * confirmation, so someone invited before having an account lands in the
 * workspace on first login. Never blocks the sign-in.
 */
export async function acceptPendingInvitations(supabase: SupabaseClient<Database>) {
  const { error } = await supabase.rpc("accept_my_pending_invitations");
  if (error) log.error("accept_my_pending_invitations failed", { error: error.message });
}
