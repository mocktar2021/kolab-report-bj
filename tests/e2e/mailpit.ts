const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type MailpitSummary = { ID: string; Subject: string; Created: string };

/** Waits for the newest e-mail to `to` whose subject matches, and returns the first callback link in it. */
export async function waitForAuthLink(to: string, subject: string, timeoutMs = 20_000): Promise<string> {
  return waitForLink(to, subject, /href="([^"]*\/fr\/auth\/callback[^"]*)"/, timeoutMs);
}

/** Same, for the first link matching `pattern` (its first group is the URL). */
export async function waitForLink(
  to: string,
  subject: string,
  pattern: RegExp,
  timeoutMs = 20_000,
): Promise<string> {
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
        const href = detail.HTML.match(pattern)?.[1];
        if (!href) throw new Error(`No matching link in "${subject}"`);
        return href.replaceAll("&amp;", "&");
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No e-mail "${subject}" for ${to} within ${timeoutMs} ms`);
}

/** Subjects of the e-mails to `to`, newest first. */
export async function subjectsFor(to: string): Promise<string[]> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  if (!res.ok) throw new Error(`Mailpit answered ${res.status}`);
  const { messages } = (await res.json()) as { messages: MailpitSummary[] };
  return messages.map((m) => m.Subject);
}

/** Waits for the newest e-mail to `to` with this subject, and returns its plain text with "\n" line ends. */
export async function waitForText(to: string, subject: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    if (res.ok) {
      const { messages } = (await res.json()) as { messages: MailpitSummary[] };
      const match = messages.find((m) => m.Subject === subject);
      if (match) {
        const detail = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`)).json()) as {
          Text: string;
        };
        // Mailpit keeps the CRLF line ends of the message.
        return detail.Text.replace(/[ \t]*\r\n/g, "\n");
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
