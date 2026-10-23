import "server-only";
import { log } from "@/lib/log";

// Launch reminders (KRB-239): a visitor leaves an e-mail before the launch and
// gets one message when sign-up opens. The address becomes a Resend contact in
// the segment below, which the launch e-mail goes to. Nothing is sent per
// sign-up: the daily e-mail quota stays for sign-up and password e-mails.

/** Resend segment "KolabReport lancement". Not a secret: it only names a list. */
export const LAUNCH_SEGMENT_ID = "c0be8b98-a919-4c4d-941e-a9efbbe28f2b";

const RESEND_API = "https://api.resend.com";

async function resend(path: string, apiKey: string, body?: unknown): Promise<Response> {
  return fetch(`${RESEND_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

/**
 * Adds the address to the launch segment. Returns false when Resend is not
 * the provider, refuses (a key limited to sending) or cannot be reached. The
 * log line gives the status, never the address.
 */
export async function saveLaunchReminder(email: string): Promise<boolean> {
  const provider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  const apiKey = process.env.RESEND_API_KEY;
  if (provider !== "resend" || !apiKey) {
    log.warn("launch reminder skipped: Resend is not the e-mail provider");
    return false;
  }
  try {
    const created = await resend("/contacts", apiKey, { email, unsubscribed: false });
    // 409 or 422: the contact exists already, from an earlier reminder or another list.
    if (!created.ok && created.status !== 409 && created.status !== 422) {
      log.warn("launch reminder: Resend refused the contact", { status: created.status });
      return false;
    }
    const added = await resend(
      `/contacts/${encodeURIComponent(email)}/segments/${LAUNCH_SEGMENT_ID}`,
      apiKey,
    );
    if (!added.ok && added.status !== 409) {
      log.warn("launch reminder: Resend refused the segment", { status: added.status });
      return false;
    }
    return true;
  } catch (error) {
    log.warn("launch reminder: Resend could not be reached", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}
