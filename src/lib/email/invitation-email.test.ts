import { describe, expect, it } from "vitest";
import { escapeHtml, invitationEmail } from "./invitation-email";

const base = {
  to: "expert@example.com",
  link: "https://app.example.com/fr/invitations/abc",
  workspaceName: "Audit 2026",
  organizationName: "Cabinet Dossou",
  inviterName: "Aïcha Kossou",
  role: "expert" as const,
  expiresAt: new Date("2026-10-20T12:00:00Z"),
};

describe("invitationEmail", () => {
  it("writes a French e-mail with the link, the role and the expiry date", () => {
    const email = invitationEmail(base);
    expect(email.to).toBe("expert@example.com");
    expect(email.subject).toBe("Aïcha Kossou vous invite sur KolabReport");
    expect(email.text).toContain("Audit 2026 (Cabinet Dossou) en tant que expert");
    expect(email.text).toContain(base.link);
    expect(email.text).toContain("20 octobre 2026");
    expect(email.html).toContain(`href="${base.link}"`);
  });

  it("escapes names typed by users", () => {
    const email = invitationEmail({ ...base, workspaceName: '<script>alert("x")</script>' });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML special characters", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
    );
  });
});
