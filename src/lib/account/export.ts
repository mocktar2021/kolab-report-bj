// "Télécharger mes données" on /fr/compte (KRB-186). The file has the shape of
// the operator export in docs/gdpr/data-subject-requests.md ("Access and
// export"), so a request answered by hand and one answered by the app give the
// same JSON. It holds the account and every row that names the person, never
// the text of reports, sections, files or AI drafts: that is the firm's content.
//
// No imports, so the unit tests run it without Supabase. The rows come from
// src/lib/account/export-server.ts.

type Row = Record<string, unknown>;

/** The rows read for the signed-in user, one list per kind. */
export type AccountExportSources = {
  /** From Supabase Auth (getUser), not from a table. */
  account: Row;
  profile: Row | null;
  sessions: Row[];
  organizationsOwned: Row[];
  /** workspace_members rows, with the workspace name joined as `workspace: { name }`. */
  memberships: Row[];
  invitationsReceived: Row[];
  invitationsSent: Row[];
  reportsCreated: Row[];
  sectionsAssigned: Row[];
  deliverablesUploaded: Row[];
  aiGenerations: Row[];
  reportExports: Row[];
  statusChanges: Row[];
  notifications: Row[];
  promptVersionsWritten: Row[];
  promptRolloutsStarted: Row[];
};

export type AccountExport = {
  exported_at: string;
  account: Row;
  profile: Row | null;
  sessions: Row[];
  organizations_owned: Row[];
  memberships: Row[];
  invitations_received: Row[];
  invitations_sent: Row[];
  reports_created: Row[];
  sections_assigned: Row[];
  deliverables_uploaded: Row[];
  ai_generations: Row[];
  report_exports: Row[];
  status_changes: Row[];
  notifications: Row[];
  prompt_versions_written: Row[];
  prompt_rollouts_started: Row[];
};

/**
 * The columns of each list, in the order of the file. Every value is copied
 * by name, so a select that reads more columns can never add them to the file.
 * Keys on the left are the names in the file, values the column they come from.
 */
export const EXPORT_COLUMNS = {
  account: {
    id: "id",
    email: "email",
    created_at: "created_at",
    email_confirmed_at: "email_confirmed_at",
    last_sign_in_at: "last_sign_in_at",
    user_metadata: "user_metadata",
  },
  profile: {
    id: "id",
    email: "email",
    full_name: "full_name",
    avatar_url: "avatar_url",
    job_title: "job_title",
    locale: "locale",
    created_at: "created_at",
    updated_at: "updated_at",
  },
  sessions: { created_at: "created_at", refreshed_at: "refreshed_at", user_agent: "user_agent", ip: "ip" },
  organizationsOwned: { id: "id", name: "name", created_at: "created_at" },
  memberships: {
    workspace_id: "workspace_id",
    workspace: "workspace",
    role: "role",
    joined_at: "created_at",
  },
  invitationsReceived: {
    workspace_id: "workspace_id",
    role: "role",
    created_at: "created_at",
    accepted_at: "accepted_at",
    revoked_at: "revoked_at",
    expires_at: "expires_at",
  },
  invitationsSent: { workspace_id: "workspace_id", email: "email", role: "role", created_at: "created_at" },
  reportsCreated: { id: "id", workspace_id: "workspace_id", title: "title", created_at: "created_at" },
  sectionsAssigned: { id: "id", report_id: "report_id", title: "title", status: "status" },
  deliverablesUploaded: {
    id: "id",
    section_id: "section_id",
    file_name: "file_name",
    storage_path: "storage_path",
    size_bytes: "size_bytes",
    created_at: "created_at",
  },
  aiGenerations: {
    id: "id",
    section_id: "section_id",
    created_at: "created_at",
    model: "model",
    status: "status",
    accepted: "accepted",
    user_rating: "user_rating",
    feedback_comment: "feedback_comment",
  },
  reportExports: {
    id: "id",
    report_id: "report_id",
    kind: "kind",
    format: "format",
    file_name: "file_name",
    created_at: "created_at",
  },
  statusChanges: { report_id: "report_id", from: "from_status", to: "to_status", changed_at: "changed_at" },
  notifications: { event_id: "event_id", created_at: "created_at", read_at: "read_at" },
  promptVersionsWritten: {
    id: "id",
    workspace_id: "workspace_id",
    template_key: "template_key",
    version: "version",
    title: "title",
    created_at: "created_at",
  },
  promptRolloutsStarted: { id: "id", template_key: "template_key", created_at: "created_at" },
} as const satisfies Record<keyof AccountExportSources, Record<string, string>>;

/** The select list of a kind: the columns the file needs, and nothing else. */
export function exportSelect(kind: Exclude<keyof AccountExportSources, "account" | "memberships">): string {
  return Object.values(EXPORT_COLUMNS[kind]).join(", ");
}

/** A joined row (`workspace: { name }`) becomes its name. */
function joinedName(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "name" in value) {
    return (value as { name: unknown }).name ?? null;
  }
  return value ?? null;
}

function pick(row: Row, columns: Record<string, string>): Row {
  const out: Row = {};
  for (const [key, column] of Object.entries(columns)) {
    const value = row[column];
    out[key] = column === "workspace" ? joinedName(value) : (value ?? null);
  }
  return out;
}

function pickAll(rows: Row[], columns: Record<string, string>): Row[] {
  return rows.map((row) => pick(row, columns));
}

/** Builds the downloaded file from the rows read for the signed-in user. */
export function buildAccountExport(sources: AccountExportSources, exportedAt: Date): AccountExport {
  const c = EXPORT_COLUMNS;
  return {
    exported_at: exportedAt.toISOString(),
    account: pick(sources.account, c.account),
    profile: sources.profile ? pick(sources.profile, c.profile) : null,
    sessions: pickAll(sources.sessions, c.sessions),
    organizations_owned: pickAll(sources.organizationsOwned, c.organizationsOwned),
    memberships: pickAll(sources.memberships, c.memberships),
    invitations_received: pickAll(sources.invitationsReceived, c.invitationsReceived),
    invitations_sent: pickAll(sources.invitationsSent, c.invitationsSent),
    reports_created: pickAll(sources.reportsCreated, c.reportsCreated),
    sections_assigned: pickAll(sources.sectionsAssigned, c.sectionsAssigned),
    deliverables_uploaded: pickAll(sources.deliverablesUploaded, c.deliverablesUploaded),
    ai_generations: pickAll(sources.aiGenerations, c.aiGenerations),
    report_exports: pickAll(sources.reportExports, c.reportExports),
    status_changes: pickAll(sources.statusChanges, c.statusChanges),
    notifications: pickAll(sources.notifications, c.notifications),
    prompt_versions_written: pickAll(sources.promptVersionsWritten, c.promptVersionsWritten),
    prompt_rollouts_started: pickAll(sources.promptRolloutsStarted, c.promptRolloutsStarted),
  };
}

/** "kolabreport-mes-donnees-2026-10-15.json", from the UTC date of the export. */
export function accountExportFileName(exportedAt: Date): string {
  return `kolabreport-mes-donnees-${exportedAt.toISOString().slice(0, 10)}.json`;
}
