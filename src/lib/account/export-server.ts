import "server-only";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  buildAccountExport,
  exportSelect,
  RECEIPT_NUMBERS,
  type AccountExport,
  type AccountExportSources,
} from "./export";

// Reads the rows of the data export for the signed-in user. `user` comes from
// getUser() on the session, never from the request, and every query below is
// filtered on its id or its e-mail.
//
// The user's client (RLS) reads what the person can see anyway: profile,
// sessions, owned organizations, memberships, assigned sections and
// notifications. The service role reads the rows that name the person but
// that RLS may hide, for example a report they created in a workspace they
// left, or an invitation sent to their address. These queries span
// workspaces by design, so they are scoped by user id instead of
// workspace_id.

/** PostgREST returns at most this many rows per request (max_rows in supabase/config.toml). */
const PAGE_SIZE = 1000;

/** Purchase ids per receipts query, to keep the URL short. */
const RECEIPT_BATCH = 100;

type Row = Record<string, unknown>;
type Page = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Every row of a query, page by page. `page` must order its rows the same way on every call. */
async function allRows(label: string, page: (from: number, to: number) => Page): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`account export: ${label}: ${error.message}`);
    const batch = (Array.isArray(data) ? data : []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

export async function loadAccountExport(user: User, exportedAt = new Date()): Promise<AccountExport> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const userId = user.id;
  const email = (user.email ?? "").trim().toLowerCase();

  const profile = supabase
    .from("profiles")
    .select(exportSelect("profile"))
    .eq("id", userId)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`account export: profile: ${error.message}`);
      return (data as Row | null) ?? null;
    });

  const [
    profileRow,
    sessions,
    organizationsOwned,
    memberships,
    invitationsReceived,
    invitationsSent,
    reportsCreated,
    sectionsAssigned,
    deliverablesUploaded,
    aiGenerations,
    reportExports,
    statusChanges,
    notifications,
    promptVersionsWritten,
    promptRolloutsStarted,
    purchases,
  ] = await Promise.all([
    profile,
    allRows("sessions", (from, to) => supabase.rpc("my_account_sessions").range(from, to)),
    allRows("organizations", (from, to) =>
      supabase
        .from("organizations")
        .select(exportSelect("organizationsOwned"))
        .eq("owner_id", userId)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    allRows("memberships", (from, to) =>
      supabase
        .from("workspace_members")
        .select("workspace_id, role, created_at, workspace:workspaces(name)")
        .eq("user_id", userId)
        .order("created_at")
        .order("workspace_id")
        .range(from, to),
    ),
    // Linked by e-mail: an invitation may come from a workspace the person never joined.
    email
      ? allRows("invitations received", (from, to) =>
          admin
            .from("workspace_invitations")
            .select(exportSelect("invitationsReceived"))
            .eq("email", email)
            .order("created_at")
            .order("id")
            .range(from, to),
        )
      : Promise.resolve([]),
    allRows("invitations sent", (from, to) =>
      admin
        .from("workspace_invitations")
        .select(exportSelect("invitationsSent"))
        .eq("invited_by", userId)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    allRows("reports", (from, to) =>
      admin
        .from("reports")
        .select(exportSelect("reportsCreated"))
        .eq("created_by", userId)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    allRows("sections", (from, to) =>
      supabase
        .from("report_sections")
        .select(exportSelect("sectionsAssigned"))
        .eq("assigned_to", userId)
        .order("id")
        .range(from, to),
    ),
    allRows("deliverables", (from, to) =>
      admin
        .from("deliverables")
        .select(exportSelect("deliverablesUploaded"))
        .eq("uploaded_by", userId)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    allRows("ai generations", (from, to) =>
      admin
        .from("ai_generations")
        .select(exportSelect("aiGenerations"))
        .eq("requested_by", userId)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    allRows("exports", (from, to) =>
      admin
        .from("report_exports")
        .select(exportSelect("reportExports"))
        .eq("created_by", userId)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    allRows("status changes", (from, to) =>
      admin
        .from("report_status_events")
        .select(exportSelect("statusChanges"))
        .eq("changed_by", userId)
        .order("changed_at")
        .order("id")
        .range(from, to),
    ),
    allRows("notifications", (from, to) =>
      supabase
        .from("notifications")
        .select(exportSelect("notifications"))
        .eq("user_id", userId)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    allRows("prompt versions", (from, to) =>
      admin
        .from("prompt_library")
        .select(exportSelect("promptVersionsWritten"))
        .eq("created_by", userId)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    allRows("prompt rollouts", (from, to) =>
      admin
        .from("prompt_rollouts")
        .select(exportSelect("promptRolloutsStarted"))
        .eq("created_by", userId)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    // Billing readers read purchases through RLS, but the person may no
    // longer be one, or the organization may be gone (organization_id null).
    allRows("purchases", (from, to) =>
      admin
        .from("billing_purchases")
        .select(exportSelect("billingPurchases"))
        .eq("created_by", userId)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
  ]);

  // The receipt numbers of those purchases only.
  const receipts = new Map<string, string[]>();
  const purchaseIds = purchases.map((purchase) => String(purchase.id));
  for (let start = 0; start < purchaseIds.length; start += RECEIPT_BATCH) {
    const ids = purchaseIds.slice(start, start + RECEIPT_BATCH);
    const rows = await allRows("receipts", (from, to) =>
      admin
        .from("billing_receipts")
        .select("purchase_id, number")
        .in("purchase_id", ids)
        .order("number")
        .range(from, to),
    );
    for (const row of rows) {
      const id = String(row.purchase_id);
      receipts.set(id, [...(receipts.get(id) ?? []), String(row.number)]);
    }
  }
  const billingPurchases = purchases.map((purchase) => ({
    ...purchase,
    [RECEIPT_NUMBERS]: receipts.get(String(purchase.id)) ?? [],
  }));

  const sources: AccountExportSources = {
    account: {
      id: user.id,
      email: user.email ?? null,
      created_at: user.created_at,
      email_confirmed_at: user.email_confirmed_at ?? null,
      last_sign_in_at: user.last_sign_in_at ?? null,
      user_metadata: user.user_metadata ?? {},
    },
    profile: profileRow,
    sessions,
    organizationsOwned,
    memberships,
    invitationsReceived,
    invitationsSent,
    reportsCreated,
    sectionsAssigned,
    deliverablesUploaded,
    aiGenerations,
    reportExports,
    statusChanges,
    notifications,
    promptVersionsWritten,
    promptRolloutsStarted,
    billingPurchases,
  };
  return buildAccountExport(sources, exportedAt);
}
