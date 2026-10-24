// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "@/lib/log";
import { saveLaunchReminder } from "./launch-reminder";

vi.mock("@/lib/log", () => ({ log: { warn: vi.fn() } }));

const fetchMock = vi.fn<typeof fetch>();
const EMAIL = "aicha@kolab.test";
const SEGMENT = "0b6e2f1c-5d4a-4c3b-9a8e-7f6d5c4b3a21";

function reply(status: number) {
  return new Response(status < 300 ? "{}" : '{"message":"no"}', { status });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("EMAIL_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_LAUNCH_SEGMENT_ID", SEGMENT);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("saveLaunchReminder", () => {
  it("creates the contact, then adds it to the launch segment", async () => {
    fetchMock.mockResolvedValueOnce(reply(201)).mockResolvedValueOnce(reply(201));

    await expect(saveLaunchReminder(EMAIL)).resolves.toBe(true);

    const [created, added] = fetchMock.mock.calls;
    expect(created![0]).toBe("https://api.resend.com/contacts");
    expect(created![1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(created![1]!.body))).toEqual({ email: EMAIL, unsubscribed: false });
    expect(new Headers(created![1]!.headers).get("authorization")).toBe("Bearer re_test_key");
    expect(added![0]).toBe(`https://api.resend.com/contacts/aicha%40kolab.test/segments/${SEGMENT}`);
  });

  it("accepts a contact that exists already", async () => {
    fetchMock.mockResolvedValueOnce(reply(409)).mockResolvedValueOnce(reply(200));
    await expect(saveLaunchReminder(EMAIL)).resolves.toBe(true);

    fetchMock.mockResolvedValueOnce(reply(422)).mockResolvedValueOnce(reply(409));
    await expect(saveLaunchReminder(EMAIL)).resolves.toBe(true);
  });

  it("reports a refusal with its status and never the address", async () => {
    fetchMock.mockResolvedValueOnce(reply(401));

    await expect(saveLaunchReminder(EMAIL)).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith("launch reminder: Resend refused the contact", { status: 401 });
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain(EMAIL);
  });

  it("fails when the segment step is refused", async () => {
    fetchMock.mockResolvedValueOnce(reply(201)).mockResolvedValueOnce(reply(404));
    await expect(saveLaunchReminder(EMAIL)).resolves.toBe(false);
  });

  it("fails when Resend cannot be reached", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(saveLaunchReminder(EMAIL)).resolves.toBe(false);
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain(EMAIL);
  });

  it("calls nothing when Resend is not the e-mail provider", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "console");
    await expect(saveLaunchReminder(EMAIL)).resolves.toBe(false);

    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "");
    await expect(saveLaunchReminder(EMAIL)).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls nothing without the launch segment of this Resend account", async () => {
    // KRB-243: the segment lives in the account of RESEND_API_KEY, so its id
    // comes from the environment, not from the code.
    vi.stubEnv("RESEND_LAUNCH_SEGMENT_ID", " ");
    await expect(saveLaunchReminder(EMAIL)).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith("launch reminder skipped: RESEND_LAUNCH_SEGMENT_ID is not set");
  });
});
