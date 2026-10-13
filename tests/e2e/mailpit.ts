const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type MailpitSummary = { ID: string; Subject: string; Created: string };

/** Waits for the newest e-mail to `to` whose subject matches, and returns the first callback link in it. */
export async function waitForAuthLink(to: string, subject: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    if (res.ok) {
      const { messages } = (await res.json()) as { messages: MailpitSummary[] };
      const match = messages.find((m) => m.Subject === subject);
      if (match) {
        const detail = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`)).json()) as {
          HTML: string;
        };
        const href = detail.HTML.match(/href="([^"]*\/fr\/auth\/callback[^"]*)"/)?.[1];
        if (!href) throw new Error(`No callback link in "${subject}"`);
        return href.replaceAll("&amp;", "&");
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No e-mail "${subject}" for ${to} within ${timeoutMs} ms`);
}

/** Deletes every message in the inbox of `to`, so later searches only see new mail. */
export async function clearInbox(to: string) {
  await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`, { method: "DELETE" });
}
