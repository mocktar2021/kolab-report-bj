// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "@/lib/log";
import { LAUNCH_SEGMENT_ID, saveLaunchReminder } from "./launch-reminder";

vi.mock("@/lib/log", () => ({ log: { warn: vi.fn() } }));

const fetchMock = vi.fn<typeof fetch>();
const EMAIL = "aicha@kolab.test";

function reply(status: number) {
  return new Response(status < 300 ? "{}" : '{"message":"no"}', { status });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("EMAIL_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
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
    expect(added![0]).toBe(
      `https://api.resend.com/contacts/aicha%40kolab.test/segments/${LAUNCH_SEGMENT_ID}`,
    );
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
});
