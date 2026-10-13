import "server-only";

export type Email = { to: string; subject: string; html: string; text: string };

type Sender = { name: string; email: string };

/** Parses EMAIL_FROM, "KolabReport <noreply@example.com>" or a bare address. */
export function parseSender(value: string | undefined): Sender {
  const fallback = { name: "KolabReport", email: "noreply@kolabreport.local" };
  if (!value?.trim()) return fallback;
  const match = value.trim().match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/);
  if (match) return { name: match[1]?.trim() || fallback.name, email: match[2] ?? fallback.email };
  return { name: fallback.name, email: value.trim() };
}

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`E-mail provider answered ${response.status}`);
  }
}

/**
 * Sends a transactional e-mail through EMAIL_PROVIDER:
 * - "brevo" (BREVO_API_KEY) or "resend" (RESEND_API_KEY) for staging and production
 * - "mailpit" (MAILPIT_URL) for the local Supabase stack and the e2e tests
 * Returns false, without throwing, when no provider is set or the send fails,
 * so callers can fall back to showing the link.
 */
export async function sendEmail(email: Email): Promise<boolean> {
  const provider = process.env.EMAIL_PROVIDER;
  const from = parseSender(process.env.EMAIL_FROM);

  try {
    switch (provider) {
      case "brevo": {
        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey) return false;
        await post(
          "https://api.brevo.com/v3/smtp/email",
          { "api-key": apiKey },
          {
            sender: from,
            to: [{ email: email.to }],
            subject: email.subject,
            htmlContent: email.html,
            textContent: email.text,
          },
        );
        return true;
      }
      case "resend": {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) return false;
        await post(
          "https://api.resend.com/emails",
          { Authorization: `Bearer ${apiKey}` },
          {
            from: `${from.name} <${from.email}>`,
            to: [email.to],
            subject: email.subject,
            html: email.html,
            text: email.text,
          },
        );
        return true;
      }
      case "mailpit": {
        const url = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
        await post(
          `${url}/api/v1/send`,
          {},
          {
            From: { Email: from.email, Name: from.name },
            To: [{ Email: email.to }],
            Subject: email.subject,
            HTML: email.html,
            Text: email.text,
          },
        );
        return true;
      }
      default:
        return false;
    }
  } catch (error) {
    console.error("sendEmail failed", error);
    return false;
  }
}
