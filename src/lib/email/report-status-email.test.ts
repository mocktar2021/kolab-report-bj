import { describe, expect, it } from "vitest";
import { reportStatusEmail } from "./report-status-email";

const base = {
  to: "expert@kolabreport.test",
  reportTitle: "Rapport à mi-parcours",
  workspaceName: "Eau potable Atacora",
  actorName: "Awa Dossou",
  link: "https://kolabreport.mocktar.com/fr/rapports/3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a",
};

describe("reportStatusEmail", () => {
  it("tells experts a report is in review", () => {
    const email = reportStatusEmail({ ...base, action: "submit" });
    expect(email.to).toBe(base.to);
    expect(email.subject).toBe("« Rapport à mi-parcours » est en revue");
    expect(email.text).toContain("Awa Dossou a soumis le rapport « Rapport à mi-parcours » pour revue.");
    expect(email.text).toContain(base.link);
    expect(email.html).toContain(`href="${base.link}"`);
  });

  it("says a final report is read-only", () => {
    const email = reportStatusEmail({ ...base, action: "finalize" });
    expect(email.subject).toBe("« Rapport à mi-parcours » est final");
    expect(email.text).toContain("Ses sections sont maintenant en lecture seule.");
  });

  it("covers sending back and reopening", () => {
    expect(reportStatusEmail({ ...base, action: "sendBack" }).subject).toContain("repasse en brouillon");
    expect(reportStatusEmail({ ...base, action: "reopen" }).subject).toContain("est rouvert");
  });

  it("escapes names and titles in the HTML", () => {
    const email = reportStatusEmail({
      ...base,
      action: "submit",
      reportTitle: '<img src=x onerror="alert(1)">',
      actorName: "Eve & <b>co</b>",
    });
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain("<b>co</b>");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(email.html).toContain("Eve &amp; &lt;b&gt;co&lt;/b&gt;");
  });
});
