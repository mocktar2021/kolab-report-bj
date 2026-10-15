import "server-only";
import { createClient } from "@/lib/supabase/server";
import { toBlockers, type DeletionBlocker } from "./blockers";

export type TransferCandidate = { userId: string; name: string };

export type OwnedOrganization = {
  id: string;
  name: string;
  /** Owners of its workspaces who can take it over. Empty: nobody yet. */
  candidates: TransferCandidate[];
};

export type AccountOverview = {
  fullName: string;
  /** Null when the check failed: the page then offers no deletion. */
  blockers: DeletionBlocker[] | null;
  organizations: OwnedOrganization[];
};

/** What /fr/compte shows for the signed-in user, read with their client (RLS). */
export async function getAccountOverview(userId: string): Promise<AccountOverview> {
  const supabase = await createClient();
  const [{ data: profile }, { data: blockerRows, error: blockerError }, { data: owned }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    supabase.rpc("my_account_deletion_blockers"),
    supabase.from("organizations").select("id, name").eq("owner_id", userId).order("name").order("id"),
  ]);

  const organizations = await Promise.all(
    (owned ?? []).map(async (organization) => {
      const { data } = await supabase.rpc("organization_transfer_candidates", {
        p_organization_id: organization.id,
      });
      return {
        id: organization.id,
        name: organization.name,
        candidates: (data ?? []).map((candidate) => ({
          userId: candidate.user_id,
          name: candidate.full_name?.trim() || candidate.email,
        })),
      };
    }),
  );

  return {
    fullName: profile?.full_name ?? "",
    blockers: blockerError || !blockerRows ? null : toBlockers(blockerRows),
    organizations,
  };
}
