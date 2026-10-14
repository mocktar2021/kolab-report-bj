import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type { ReportStatus } from "@/lib/reports/status";
import messages from "../../messages/fr.json";
import { FrozenReportNotice } from "./frozen-report-notice";
import { ReportStatusBadge } from "./report-status-badge";

function renderBadge(status: ReportStatus) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <ReportStatusBadge status={status} />
    </NextIntlClientProvider>,
  );
}

describe("ReportStatusBadge", () => {
  it.each([
    ["draft", "Brouillon"],
    ["in_review", "En revue"],
    ["final", "Final"],
  ] as const)("says %s in French", (status, label) => {
    renderBadge(status);
    const badge = screen.getByText(label);
    expect(badge).toHaveAttribute("data-status", status);
    expect(badge).toHaveTextContent(new RegExp(`^${label}$`));
  });

  it("marks the final version with a lock and the ink fill", () => {
    renderBadge("final");
    const badge = screen.getByText("Final");
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(badge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(badge).toHaveClass("bg-primary", "text-primary-foreground");
  });

  it("gives draft and review a dot rather than a lock", () => {
    for (const status of ["draft", "in_review"] as const) {
      const { container, unmount } = renderBadge(status);
      expect(container.querySelector("svg")).toBeNull();
      expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
      unmount();
    }
  });
});

describe("FrozenReportNotice", () => {
  it("says the sections are read-only and who can reopen the report", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <FrozenReportNotice />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText(
        "Ce rapport est final : ses sections sont en lecture seule. Un propriétaire peut le rouvrir en brouillon.",
      ),
    ).toBeVisible();
  });
});
