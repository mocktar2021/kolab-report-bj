// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  accountExportFileName,
  buildAccountExport,
  EXPORT_COLUMNS,
  exportSelect,
  type AccountExportSources,
} from "./export";

const USER_ID = "3f0c2a1b-5d4e-4f6a-8b7c-9d0e1f2a3b4c";
const WORKSPACE_ID = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d";
const EXPORTED_AT = new Date("2026-10-15T09:30:00.000Z");

function emptySources(): AccountExportSources {
  return {
    account: { id: USER_ID, email: "awa@cabinet.test", created_at: "2026-10-01T08:00:00Z" },
    profile: null,
    sessions: [],
    organizationsOwned: [],
    memberships: [],
    invitationsReceived: [],
    invitationsSent: [],
    reportsCreated: [],
    sectionsAssigned: [],
    deliverablesUploaded: [],
    aiGenerations: [],
    templateWriterCalls: [],
    reportExports: [],
    statusChanges: [],
    notifications: [],
    promptVersionsWritten: [],
    promptRolloutsStarted: [],
    billingPurchases: [],
  };
}

describe("buildAccountExport", () => {
  it("has the keys of the operator export, in its order", () => {
    const file = buildAccountExport(emptySources(), EXPORTED_AT);
    expect(Object.keys(file)).toEqual([
      "exported_at",
      "account",
      "profile",
      "sessions",
      "organizations_owned",
      "memberships",
      "invitations_received",
      "invitations_sent",
      "reports_created",
      "sections_assigned",
      "deliverables_uploaded",
      "ai_generations",
      "template_writer_calls",
      "report_exports",
      "status_changes",
      "notifications",
      "prompt_versions_written",
      "prompt_rollouts_started",
      "billing_purchases",
    ]);
    expect(file.exported_at).toBe("2026-10-15T09:30:00.000Z");
  });

  it("gives empty lists and a null profile when there is nothing, and null for missing account fields", () => {
    const file = buildAccountExport(emptySources(), EXPORTED_AT);
    expect(file.profile).toBeNull();
    expect(file.memberships).toEqual([]);
    expect(file.ai_generations).toEqual([]);
    expect(file.account).toEqual({
      id: USER_ID,
      email: "awa@cabinet.test",
      created_at: "2026-10-01T08:00:00Z",
      email_confirmed_at: null,
      last_sign_in_at: null,
      user_metadata: null,
    });
  });

  it("renames the columns the runbook renames and joins the workspace name", () => {
    const sources = emptySources();
    sources.memberships = [
      {
        workspace_id: WORKSPACE_ID,
        role: "owner",
        created_at: "2026-10-02T10:00:00Z",
        workspace: { name: "Etude Abomey" },
      },
      { workspace_id: WORKSPACE_ID, role: "viewer", created_at: "2026-10-03T10:00:00Z", workspace: null },
    ];
    sources.statusChanges = [
      { report_id: "r1", from_status: "draft", to_status: "in_review", changed_at: "2026-10-04T10:00:00Z" },
    ];
    const file = buildAccountExport(sources, EXPORTED_AT);
    expect(file.memberships).toEqual([
      {
        workspace_id: WORKSPACE_ID,
        workspace: "Etude Abomey",
        role: "owner",
        joined_at: "2026-10-02T10:00:00Z",
      },
      { workspace_id: WORKSPACE_ID, workspace: null, role: "viewer", joined_at: "2026-10-03T10:00:00Z" },
    ]);
    expect(file.status_changes).toEqual([
      { report_id: "r1", from: "draft", to: "in_review", changed_at: "2026-10-04T10:00:00Z" },
    ]);
  });

  it("keeps the requester's rating and comment on a draft, never its text", () => {
    const sources = emptySources();
    sources.aiGenerations = [
      {
        id: "g1",
        section_id: null,
        created_at: "2026-10-05T10:00:00Z",
        model: "claude-sonnet",
        status: "succeeded",
        accepted: true,
        user_rating: 1,
        feedback_comment: "Bon point de départ.",
        output: { blocks: ["Texte du brouillon"] },
        raw_output: "Texte du brouillon",
        context_meta: { files: ["rapport-client.docx"] },
      },
    ];
    const [generation] = buildAccountExport(sources, EXPORTED_AT).ai_generations;
    expect(generation).toEqual({
      id: "g1",
      section_id: null,
      created_at: "2026-10-05T10:00:00Z",
      model: "claude-sonnet",
      status: "succeeded",
      accepted: true,
      user_rating: 1,
      feedback_comment: "Bon point de départ.",
    });
  });

  it("lists the person's \"Rédiger avec l'IA\" calls with their model and status only", () => {
    const sources = emptySources();
    sources.templateWriterCalls = [
      {
        id: "c1",
        workspace_id: WORKSPACE_ID,
        created_at: "2026-10-06T10:00:00Z",
        model: "claude-haiku-5-5",
        status: "succeeded",
        input_tokens: 900,
        cost_estimate: 0.004,
      },
    ];
    expect(buildAccountExport(sources, EXPORTED_AT).template_writer_calls).toEqual([
      {
        id: "c1",
        workspace_id: WORKSPACE_ID,
        created_at: "2026-10-06T10:00:00Z",
        model: "claude-haiku-5-5",
        status: "succeeded",
      },
    ]);
    expect(exportSelect("templateWriterCalls")).toBe("id, workspace_id, created_at, model, status");
  });

  it("drops every column it does not list, so a wider select adds nothing to the file", () => {
    const sources = emptySources();
    sources.profile = {
      id: USER_ID,
      email: "awa@cabinet.test",
      full_name: "Awa Dossou",
      locale: "fr",
      secret_column: "x",
    };
    sources.sectionsAssigned = [
      { id: "s1", report_id: "r1", title: "Contexte", status: "in_progress", content: "Texte confidentiel" },
    ];
    sources.deliverablesUploaded = [
      {
        id: "d1",
        section_id: "s1",
        file_name: "plan.docx",
        storage_path: `${WORKSPACE_ID}/s1/d1-plan.docx`,
        size_bytes: 1000,
        created_at: "2026-10-06T10:00:00Z",
        parsed_content: "Texte extrait du fichier",
      },
    ];
    const file = buildAccountExport(sources, EXPORTED_AT);
    const text = JSON.stringify(file);
    expect(text).not.toContain("Texte confidentiel");
    expect(text).not.toContain("Texte extrait");
    expect(text).not.toContain("secret_column");
    expect(file.profile).toMatchObject({ full_name: "Awa Dossou", avatar_url: null, job_title: null });
    expect(file.sections_assigned).toEqual([
      { id: "s1", report_id: "r1", title: "Contexte", status: "in_progress" },
    ]);
  });
});

describe("notifications", () => {
  it("says which kind each one is, with the renewal reminder of a billing one", () => {
    const sources = emptySources();
    sources.notifications = [
      { kind: "report_status", event_id: 12, created_at: "2026-10-09T10:00:00Z", read_at: null },
      {
        kind: "billing",
        event_id: null,
        organization_id: "o1",
        entitlement_id: "e1",
        billing_notice: "d7",
        created_at: "2026-10-10T05:17:00Z",
        read_at: "2026-10-10T08:00:00Z",
        user_id: USER_ID,
      },
    ];
    expect(buildAccountExport(sources, EXPORTED_AT).notifications).toEqual([
      {
        kind: "report_status",
        event_id: 12,
        organization_id: null,
        entitlement_id: null,
        billing_notice: null,
        created_at: "2026-10-09T10:00:00Z",
        read_at: null,
      },
      {
        kind: "billing",
        event_id: null,
        organization_id: "o1",
        entitlement_id: "e1",
        billing_notice: "d7",
        created_at: "2026-10-10T05:17:00Z",
        read_at: "2026-10-10T08:00:00Z",
      },
    ]);
  });
});

describe("billing purchases", () => {
  it("lists the order, its amounts and the receipt numbers, not the FedaPay details", () => {
    const sources = emptySources();
    sources.billingPurchases = [
      {
        id: "p1",
        organization_id: null,
        workspace_id: null,
        offer: "cabinet_month",
        offer_label: "Cabinet, 1 mois",
        quantity: 1,
        amount_ht_xof: 45000,
        tax_xof: 0,
        amount_xof: 45000,
        currency: "XOF",
        method: "fedapay",
        status: "paid",
        merchant_reference: "KR-p1",
        created_at: "2026-10-07T10:00:00Z",
        paid_at: "2026-10-07T10:02:00Z",
        receipt_numbers: ["KR-2026-000004"],
        fedapay_transaction_id: 104582,
        fedapay_mode: "mtn_open",
        fedapay_fees_xof: 900,
        terms: { accepted: true },
      },
      { id: "p2", status: "pending", created_at: "2026-10-08T10:00:00Z" },
    ];
    const [paid, pending] = buildAccountExport(sources, EXPORTED_AT).billing_purchases;
    expect(paid).toEqual({
      id: "p1",
      organization_id: null,
      workspace_id: null,
      offer: "cabinet_month",
      offer_label: "Cabinet, 1 mois",
      quantity: 1,
      amount_ht_xof: 45000,
      tax_xof: 0,
      amount_xof: 45000,
      currency: "XOF",
      method: "fedapay",
      status: "paid",
      merchant_reference: "KR-p1",
      created_at: "2026-10-07T10:00:00Z",
      paid_at: "2026-10-07T10:02:00Z",
      receipt_numbers: ["KR-2026-000004"],
    });
    expect(pending).toMatchObject({ id: "p2", status: "pending", paid_at: null, receipt_numbers: [] });
  });

  it("reads the purchase columns, not the receipt numbers it adds itself", () => {
    const select = exportSelect("billingPurchases");
    expect(select).toContain("merchant_reference");
    expect(select).not.toContain("receipt_numbers");
    expect(select).not.toContain("fedapay");
  });
});

describe("exportSelect", () => {
  it("reads only the columns the file keeps", () => {
    expect(exportSelect("reportsCreated")).toBe("id, workspace_id, title, created_at");
    expect(exportSelect("statusChanges")).toBe("report_id, from_status, to_status, changed_at");
  });

  it("never reads the text of a report, a section, a file or a draft", () => {
    const columns = Object.values(EXPORT_COLUMNS).flatMap((kind) => Object.values(kind));
    for (const column of [
      "content",
      "parsed_content",
      "output",
      "raw_output",
      "ai_draft",
      "template",
      "instructions",
    ]) {
      expect(columns).not.toContain(column);
    }
  });
});

describe("accountExportFileName", () => {
  it("names the file after the UTC day of the export", () => {
    expect(accountExportFileName(EXPORTED_AT)).toBe("kolabreport-mes-donnees-2026-10-15.json");
    expect(accountExportFileName(new Date("2026-12-31T23:59:59Z"))).toBe(
      "kolabreport-mes-donnees-2026-12-31.json",
    );
  });
});
