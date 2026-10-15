// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/email/send";
import { recordAccountDeletion, resetDeletionRecordWarning } from "./deletion-record";

vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));

const USER_ID = "3f0c2a1b-5d4e-4f6a-8b7c-9d0e1f2a3b4c";
const DELETED_AT = new Date("2026-10-15T09:30:00.000Z");

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetDeletionRecordWarning();
  // The logger writes warnings with console.log and errors with console.error.
  warn = vi.spyOn(console, "log").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function logged(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
}

describe("recordAccountDeletion", () => {
  it("e-mails the id and the date to ACCOUNT_DELETION_LOG_EMAIL", async () => {
    vi.stubEnv("ACCOUNT_DELETION_LOG_EMAIL", " registre@mocktar.example ");
    vi.stubEnv("APP_ENV", "staging");
    vi.mocked(sendEmail).mockResolvedValue(true);

    await recordAccountDeletion(USER_ID, DELETED_AT);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const email = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(email.to).toBe("registre@mocktar.example");
    expect(email.subject).toBe(`[KolabReport staging] Compte supprimé ${USER_ID}`);
    expect(email.text).toContain("2026-10-15T09:30:00.000Z");
  });

  it("warns once and sends nothing when the setting is empty", async () => {
    vi.stubEnv("ACCOUNT_DELETION_LOG_EMAIL", "");

    await recordAccountDeletion(USER_ID, DELETED_AT);
    await recordAccountDeletion(USER_ID, DELETED_AT);

    expect(sendEmail).not.toHaveBeenCalled();
    const lines = logged(warn)
      .split("\n")
      .filter((line) => line.includes("ACCOUNT_DELETION_LOG_EMAIL"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"level":"warn"');
    expect(lines[0]).toContain("is not set");
  });

  it("treats a value that is not an address like a missing one", async () => {
    vi.stubEnv("ACCOUNT_DELETION_LOG_EMAIL", "pas-une-adresse");

    await recordAccountDeletion(USER_ID, DELETED_AT);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(logged(warn)).toContain("is not an e-mail address");
  });

  it("never throws when the e-mail does not go out", async () => {
    vi.stubEnv("ACCOUNT_DELETION_LOG_EMAIL", "registre@mocktar.example");
    vi.mocked(sendEmail).mockResolvedValueOnce(false);
    await expect(recordAccountDeletion(USER_ID, DELETED_AT)).resolves.toBeUndefined();

    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("provider down"));
    await expect(recordAccountDeletion(USER_ID, DELETED_AT)).resolves.toBeUndefined();

    const errors = logged(error);
    expect(errors).toContain("account: the deletion record could not be sent");
    expect(errors).toContain(USER_ID);
    expect(errors).not.toContain("registre@mocktar.example");
  });
});
