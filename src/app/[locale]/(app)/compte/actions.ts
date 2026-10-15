"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { TRANSFER_DONE, TRANSFER_DONE_PARAM } from "@/lib/account/blockers";
import { verifyPassword } from "@/lib/account/password";
import { readCaptchaToken } from "@/lib/auth/captcha";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { CURRENT_WORKSPACE_COOKIE } from "@/lib/workspaces/server";

// Server actions of /fr/compte (KRB-186). Every action works on the user of
// the session (getUser), never on an id sent by the form.

// ---------------------------------------------------------------------------
// Name
// ---------------------------------------------------------------------------

export type NameState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; error: "nameRequired" | "generic" };

const fullNameSchema = z.string().trim().min(1).max(120);

/** Changes profiles.full_name, and the copy Supabase Auth keeps from the sign-up form. */
export async function updateName(_prev: NameState, formData: FormData): Promise<NameState> {
  const parsed = fullNameSchema.safeParse(formData.get("fullName"));
  if (!parsed.success) return { status: "error", error: "nameRequired" };
  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "generic" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data })
    .eq("id", user.id)
    .select("id");
  if (error || !data || data.length === 0) {
    log.error("account: could not save the name", { userId: user.id, error: error?.message });
    return { status: "error", error: "generic" };
  }
  const { error: authError } = await supabase.auth.updateUser({ data: { full_name: parsed.data } });
  if (authError) {
    // The app reads profiles. The Auth copy only shows in the data export.
    log.warn("account: could not copy the name to Supabase Auth", {
      userId: user.id,
      error: authError.message,
    });
  }

  revalidatePath("/", "layout");
  return { status: "saved" };
}

// ---------------------------------------------------------------------------
// Organization transfer
// ---------------------------------------------------------------------------

export type TransferError = "invalidInput" | "forbidden" | "notEligible" | "generic";

export type TransferState = { status: "idle" } | { status: "error"; error: TransferError };

/**
 * Hands an organization the user owns to an owner of one of its workspaces.
 * transfer_organization checks both rules again and records the change in
 * the billing audit log. The organization then leaves the transfer list, so
 * the page shows the outcome from the URL instead of the form's state.
 */
export async function transferOrganization(_prev: TransferState, formData: FormData): Promise<TransferState> {
  const parsed = z
    .object({ organizationId: uuidSchema, newOwnerId: uuidSchema })
    .safeParse({ organizationId: formData.get("organizationId"), newOwnerId: formData.get("newOwnerId") });
  if (!parsed.success) return { status: "error", error: "invalidInput" };
  const { organizationId, newOwnerId } = parsed.data;
  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "forbidden" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_organization", {
    p_organization_id: organizationId,
    p_new_owner_id: newOwnerId,
  });
  if (error) {
    if (error.code === "42501") return { status: "error", error: "forbidden" };
    if (error.code === "KR061") return { status: "error", error: "notEligible" };
    log.error("account: organization transfer failed", { organizationId, error: error.message });
    return { status: "error", error: "generic" };
  }

  log.info("account: organization transferred", { organizationId, previousOwnerId: user.id, newOwnerId });
  revalidatePath("/", "layout");
  const locale = await getLocale();
  return redirect({ href: { pathname: "/compte", query: { [TRANSFER_DONE_PARAM]: TRANSFER_DONE } }, locale });
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

export type DeleteAccountError =
  | "invalidInput"
  | "emailMismatch"
  | "wrongPassword"
  | "busy"
  | "rateLimited"
  | "captchaRequired"
  | "blocked"
  | "generic";

/** `email` refills the field after a refusal; the password is typed again. */
export type DeleteAccountState =
  | { status: "idle" }
  | { status: "error"; error: DeleteAccountError; email: string };

const deleteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

type UserClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The steps after the lock: password, blockers, cleanup, then the Auth
 * delete. Returns why it stopped, or null once the account is gone.
 */
async function runDeletion(
  supabase: UserClient,
  user: { id: string; email: string },
  password: string,
  captchaToken: string | undefined,
): Promise<DeleteAccountError | null> {
  const check = await verifyPassword(user, password, captchaToken);
  if (check !== "ok") {
    if (check === "wrongPassword") log.info("account: deletion refused, wrong password", { userId: user.id });
    return check;
  }

  const { data: blockers, error: blockerError } = await supabase.rpc("my_account_deletion_blockers");
  if (blockerError || !blockers) {
    log.error("account: could not check the deletion blockers", {
      userId: user.id,
      error: blockerError?.message,
    });
    return "generic";
  }
  if (blockers.length > 0) {
    log.info("account: deletion refused, blocked", { userId: user.id, blockers: blockers.length });
    return "blocked";
  }

  // The service role, for the id of the session only: clear the Storage
  // owners, AI feedback comments, invitations to the address and
  // notifications, then delete the Auth user. The cleanup checks the
  // blockers again and changes nothing when one appeared since.
  const admin = createAdminClient();
  const { data: cleared, error: cleanupError } = await admin.rpc("prepare_account_deletion", {
    p_user_id: user.id,
  });
  if (cleanupError) {
    if (cleanupError.code === "KR060") return "blocked";
    log.error("account: cleanup before deletion failed", { userId: user.id, error: cleanupError.message });
    return "generic";
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    log.error("account: could not delete the account", { userId: user.id, error: deleteError.message });
    return "generic";
  }

  log.info("account: deleted", { userId: user.id, cleared });
  return null;
}

/** Ends the session in this browser and drops the app's cookies. */
async function endSession(supabase: UserClient) {
  // The user is gone, so Supabase answers 404 or 401: signOut still clears the cookies.
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (cookie.name.startsWith("sb-")) store.delete(cookie.name);
  }
  store.delete(CURRENT_WORKSPACE_COOKIE);
}

/**
 * Deletes the signed-in user's account once they typed its e-mail address
 * and their current password. One deletion at a time per person and 5 tries
 * in 15 minutes (claim_account_deletion), so a double click runs it once.
 * Logs carry the user id, never the e-mail or the password.
 */
export async function deleteAccount(
  _prev: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const email = String(formData.get("email") ?? "");
  const refuse = (error: DeleteAccountError): DeleteAccountState => ({ status: "error", error, email });
  const parsed = deleteSchema.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) return refuse("invalidInput");
  const captcha = readCaptchaToken(formData);
  if (!captcha.ok) return refuse("captchaRequired");

  const user = await getCurrentUser();
  if (!user?.email) return refuse("generic");
  if (parsed.data.email !== user.email.trim().toLowerCase()) return refuse("emailMismatch");

  const supabase = await createClient();
  const { data: claim, error: claimError } = await supabase.rpc("claim_account_deletion");
  if (claimError) {
    log.error("account: could not start the deletion", { userId: user.id, error: claimError.message });
    return refuse("generic");
  }
  if (claim === "busy") return refuse("busy");
  if (claim === "rate_limited") {
    log.warn("account: deletion tries over the limit", { userId: user.id });
    return refuse("rateLimited");
  }

  const stopped = await runDeletion(
    supabase,
    { id: user.id, email: user.email },
    parsed.data.password,
    captcha.token,
  ).catch((error: unknown) => {
    log.error("account: deletion crashed", { userId: user.id, error });
    return "generic" as const;
  });
  if (stopped) {
    await supabase.rpc("release_account_deletion");
    return refuse(stopped);
  }

  await endSession(supabase);
  const locale = await getLocale();
  return redirect({ href: "/compte-supprime", locale });
}
