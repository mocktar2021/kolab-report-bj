import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../../../messages/fr.json";
import { RecentExports, type RecentExport } from "./recent-exports";

function file(id: string, overrides: Partial<RecentExport>): RecentExport {
  return {
    id,
    kind: "manual",
    format: "pdf",
    withAnnexes: true,
    fileName: `${id}.pdf`,
    sizeBytes: 2048,
    createdAt: "2026-10-14T09:32:00.000Z",
    createdBy: null,
    url: `/api/exports/${id}`,
    authorName: "Fatou Dossou",
    ...overrides,
  };
}

describe("RecentExports", () => {
  it("labels the stored final version and only that one", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
        <RecentExports
          exports={[
            file("audit-final", { kind: "final" }),
            file("audit-manuel", { kind: "manual", format: "docx", fileName: "audit-manuel.docx" }),
          ]}
        />
      </NextIntlClientProvider>,
    );

    const [final, manual] = screen.getAllByRole("listitem");
    expect(final).toHaveTextContent("Version finale");
    expect(final).toHaveTextContent("PDF");
    expect(manual).not.toHaveTextContent("Version finale");
    expect(screen.getByRole("link", { name: "Télécharger audit-final.pdf" })).toHaveAttribute(
      "href",
      "/api/exports/audit-final",
    );
  });

  it("tells an export with the annexes from one without (KRB-215)", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
        <RecentExports
          exports={[file("audit-sans", { withAnnexes: false }), file("audit-avec", { withAnnexes: true })]}
        />
      </NextIntlClientProvider>,
    );

    const [without, withAnnexes] = screen.getAllByRole("listitem");
    expect(without).toHaveTextContent("sans annexes");
    expect(without).not.toHaveTextContent("avec annexes");
    expect(withAnnexes).toHaveTextContent("avec annexes");
    expect(withAnnexes).not.toHaveTextContent("sans annexes");
  });
});
