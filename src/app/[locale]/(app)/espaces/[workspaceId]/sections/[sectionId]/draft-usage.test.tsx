import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type { DeliverableUse } from "@/lib/ai/types";
import messages from "../../../../../../../../messages/fr.json";
import { TruncationNotice } from "./draft-usage";

function deliverable(ref: string, fileName: string, changes: Partial<DeliverableUse> = {}): DeliverableUse {
  return {
    ref,
    id: `id-${ref}`,
    fileName,
    originalTokens: 1000,
    keptTokens: 1000,
    truncated: false,
    summarized: false,
    dropped: false,
    rowsCut: 0,
    ...changes,
  };
}

function renderNotice(deliverables: DeliverableUse[], list: boolean) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <TruncationNotice deliverables={deliverables} list={list} />
    </NextIntlClientProvider>,
  );
}

const WHOLE = deliverable("L1", "Rapport.docx");
const TABLE = deliverable("L2", "Enquete.xlsx", { truncated: true, rowsCut: 140 });

describe("TruncationNotice (KRB-250)", () => {
  it("talks about the table, not about room, when only rows were cut", () => {
    const { container } = renderNotice([WHOLE, TABLE], false);
    expect(container).toHaveTextContent(
      "Un livrable contient un tableau trop long : l'IA n'en a reçu que les premières lignes. " +
        "Le brouillon peut manquer des éléments. Le détail par livrable est sous « Livrables utilisés ».",
    );
    expect(container).not.toHaveTextContent(/place/);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("counts several tables", () => {
    const other = deliverable("L3", "Budget.csv", { truncated: true, rowsCut: 12 });
    const { container } = renderNotice([TABLE, other], false);
    expect(container).toHaveTextContent(
      "2 livrables contiennent des tableaux trop longs : l'IA n'en a reçu que les premières lignes.",
    );
  });

  it("gives one sentence per reason and lists the files while generating", () => {
    const summarized = deliverable("L3", "Etude.pdf", { truncated: true, summarized: true });
    const capped = deliverable("L4", "Annexe.docx", { truncated: true });
    const dropped = deliverable("L5", "Photos.docx", { truncated: true, dropped: true });
    const { container } = renderNotice([WHOLE, TABLE, summarized, capped, dropped], true);
    expect(container).toHaveTextContent(
      "Un livrable contient un tableau trop long : l'IA n'en a reçu que les premières lignes. " +
        "2 livrables trop longs ont été raccourcis ou résumés en partie pour l'IA. " +
        "Faute de place, un livrable n'a été transmis à l'IA que par son nom. " +
        "Le brouillon peut manquer des éléments.",
    );
    expect(container).not.toHaveTextContent("Livrables utilisés");
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      "Enquete.xlsx (140 lignes de tableau coupées)",
      "Etude.pdf (résumé en partie)",
      "Annexe.docx (raccourci)",
      "Photos.docx (laissé de côté, seul son nom a été transmis)",
    ]);
  });

  it("keeps a neutral sentence when it can't name a reason", () => {
    const { container } = renderNotice([], false);
    expect(container).toHaveTextContent(
      "Certains livrables n'ont pas été transmis en entier à l'IA. Le brouillon peut manquer des éléments.",
    );
  });
});
