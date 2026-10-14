import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type { ReportStatus } from "@/lib/reports/status";
import messages from "../../../../../../messages/fr.json";
import { LastStatusChange } from "./last-status-change";

// 09:32 UTC is 10:32 in Porto-Novo.
const AT = "2026-10-14T09:32:00.000Z";

function renderLine(
  status: ReportStatus,
  change: { to: ReportStatus; at: string; byName: string | null } | null,
) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <LastStatusChange status={status} change={change} />
    </NextIntlClientProvider>,
  );
}

describe("LastStatusChange", () => {
  it.each([
    ["final", "Final depuis le 14 octobre 2026 à 10:32, par Fatou Dossou"],
    ["in_review", "En revue depuis le 14 octobre 2026 à 10:32, par Fatou Dossou"],
    ["draft", "Brouillon depuis le 14 octobre 2026 à 10:32, par Fatou Dossou"],
  ] as const)("says since when the report is %s and who did it", (status, text) => {
    const { container } = renderLine(status, { to: status, at: AT, byName: "Fatou Dossou" });

    expect(container).toHaveTextContent(text);
    expect(container.querySelector("time")).toHaveAttribute("dateTime", AT);
  });

  it("leaves the name out when nobody is known", () => {
    const { container } = renderLine("final", { to: "final", at: AT, byName: null });
    expect(container.textContent).toBe("Final depuis le 14 octobre 2026 à 10:32");
  });

  it("shows nothing without a change, or when the change is not the current status", () => {
    expect(renderLine("draft", null).container).toBeEmptyDOMElement();
    expect(
      renderLine("draft", { to: "final", at: AT, byName: "Fatou Dossou" }).container,
    ).toBeEmptyDOMElement();
  });
});
