// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Email } from "@/lib/email/send";
import { renewLink, sendBillingNotices } from "./notices";

vi.mock("@/lib/env", () => ({
  publicEnv: { NEXT_PUBLIC_APP_URL: "https://kolabreport.mocktar.com" },
}));

const ORG = "5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c";

function dueRow(overrides: Record<string, unknown> = {}) {
  return {
    entitlement_id: "aaaaaaaa-1111-4111-8111-111111111111",
    kind: "d7",
    organization_id: ORG,
    organization_name: "Cabinet Dossou",
    workspace_id: null,
    workspace_name: null,
    plan: "cabinet",
    ends_at: "2026-10-21T13:00:00+00:00",
    grace_ends_at: "2026-10-28T13:00:00+00:00",
    recipients: [
      {
        user_id: "11111111-1111-4111-8111-111111111111",
        email: "awa@cabinet-dossou.test",
        name: "Awa Dossou",
      },
      { user_id: "22222222-2222-4222-8222-222222222222", email: "koffi@cabinet-dossou.test", name: "Koffi" },
    ],
    ...overrides,
  };
}

/** Service-role client stand-in: the two functions the module calls. */
function fakeAdmin(rows: unknown[] | null, options: { claimError?: boolean; finishError?: boolean } = {}) {
  const finished: unknown[] = [];
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "billing_due_notices") {
      return options.claimError
        ? { data: null, error: { message: "claim failed" } }
        : { data: rows, error: null };
    }
    if (name === "billing_finish_notice") {
      finished.push(args);
      return options.finishError
        ? { data: null, error: { message: "finish failed" } }
        : { data: true, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  const client = { rpc } as unknown as Parameters<typeof sendBillingNotices>[0];
  return { client, rpc, finished };
}

const NOW = () => new Date("2026-10-14T04:17:00Z");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("renewLink", () => {
  it("points at the organization's billing page", () => {
    expect(renewLink("https://kolabreport.mocktar.com/", ORG)).toBe(
      `https://kolabreport.mocktar.com/fr/organisations/${ORG}/abonnement`,
    );
  });
});

describe("sendBillingNotices", () => {
  it("e-mails every recipient of each claimed notice, then records the result", async () => {
    const admin = fakeAdmin([
      dueRow(),
      dueRow({ entitlement_id: "bbbbbbbb-2222-4222-8222-222222222222", kind: "ended" }),
    ]);
    const sent: Email[] = [];
    const send = vi.fn(async (email: Email) => {
      sent.push(email);
      return true;
    });

    const summary = await sendBillingNotices(admin.client, { send, now: NOW });

    expect(summary).toEqual({ notices: 2, emailsSent: 4, emailsFailed: 0, ok: true });
    expect(admin.rpc).toHaveBeenNthCalledWith(1, "billing_due_notices");
    expect(sent.map((email) => email.to)).toEqual([
      "awa@cabinet-dossou.test",
      "koffi@cabinet-dossou.test",
      "awa@cabinet-dossou.test",
      "koffi@cabinet-dossou.test",
    ]);
    expect(sent[0]?.subject).toBe("Votre offre KolabReport se termine dans 7 jours");
    expect(sent[0]?.html).toContain(
      `href="https://kolabreport.mocktar.com/fr/organisations/${ORG}/abonnement"`,
    );
    expect(sent[2]?.subject).toBe("Votre offre KolabReport est terminée");
    expect(admin.finished).toEqual([
      { p_entitlement_id: "aaaaaaaa-1111-4111-8111-111111111111", p_kind: "d7", p_sent: 2, p_failed: 0 },
      { p_entitlement_id: "bbbbbbbb-2222-4222-8222-222222222222", p_kind: "ended", p_sent: 2, p_failed: 0 },
    ]);
  });

  it("does nothing when nothing is due", async () => {
    const admin = fakeAdmin([]);
    const send = vi.fn();

    expect(await sendBillingNotices(admin.client, { send, now: NOW })).toEqual({
      notices: 0,
      emailsSent: 0,
      emailsFailed: 0,
      ok: true,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("counts failed e-mails, records them and fails the run", async () => {
    const admin = fakeAdmin([dueRow()]);
    const send = vi.fn(async (email: Email) => email.to.startsWith("awa"));

    const summary = await sendBillingNotices(admin.client, { send, now: NOW });

    expect(summary).toEqual({ notices: 1, emailsSent: 1, emailsFailed: 1, ok: false });
    expect(admin.finished).toEqual([
      { p_entitlement_id: "aaaaaaaa-1111-4111-8111-111111111111", p_kind: "d7", p_sent: 1, p_failed: 1 },
    ]);
  });

  it("treats a send that throws as failed", async () => {
    const admin = fakeAdmin([dueRow({ recipients: [dueRow().recipients[0]] })]);
    const send = vi.fn(async () => {
      throw new Error("network down");
    });

    expect(await sendBillingNotices(admin.client, { send, now: NOW })).toEqual({
      notices: 1,
      emailsSent: 0,
      emailsFailed: 1,
      ok: false,
    });
  });

  it("records a notice without recipients, without failing", async () => {
    const admin = fakeAdmin([dueRow({ recipients: [] })]);

    expect(await sendBillingNotices(admin.client, { send: vi.fn(), now: NOW })).toEqual({
      notices: 1,
      emailsSent: 0,
      emailsFailed: 0,
      ok: true,
    });
    expect(admin.finished).toHaveLength(1);
  });

  it("fails without sending when the claim fails", async () => {
    const admin = fakeAdmin(null, { claimError: true });
    const send = vi.fn();

    expect((await sendBillingNotices(admin.client, { send, now: NOW })).ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("fails when a row cannot be read or the result cannot be recorded", async () => {
    const unreadable = fakeAdmin([dueRow({ kind: "d30" })]);
    expect(await sendBillingNotices(unreadable.client, { send: vi.fn(), now: NOW })).toMatchObject({
      notices: 1,
      ok: false,
    });

    const unrecorded = fakeAdmin([dueRow()], { finishError: true });
    expect(
      await sendBillingNotices(unrecorded.client, { send: vi.fn(async () => true), now: NOW }),
    ).toMatchObject({ emailsSent: 2, ok: false });
  });

  it("logs ids and counts, never an address", async () => {
    const admin = fakeAdmin([dueRow()]);
    await sendBillingNotices(admin.client, { send: vi.fn(async () => false), now: NOW });

    const logged = [console.error, console.warn, console.info, console.log]
      .flatMap((spy) => vi.mocked(spy).mock.calls.flat())
      .map(String)
      .join("\n");
    expect(logged).not.toContain("@cabinet-dossou.test");
    expect(logged).not.toContain("Awa Dossou");
  });
});
