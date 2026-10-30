// @vitest-environment node
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../messages/fr.json";
import { LANDING_META_VALUES, MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH, PRICING_META_VALUES } from "./copy";

const t = createTranslator({
  locale: "fr",
  messages,
  onError: (error) => {
    throw error;
  },
});

/** The title as the browser tab and the results show it. */
const withTemplate = (title: string) => t("Metadata.titleTemplate").replace("%s", title);

// The home page sets an absolute title; the others get the template.
const PAGES = [
  {
    page: "home",
    title: t("Landing.metaTitle"),
    description: t("Landing.metaDescription", LANDING_META_VALUES),
  },
  {
    page: "tarifs",
    title: withTemplate(t("Pricing.metaTitle", PRICING_META_VALUES)),
    description: t("Pricing.metaDescription", PRICING_META_VALUES),
  },
  {
    page: "guide",
    title: withTemplate(t("Guide.metaTitle")),
    description: t("Guide.metaDescription"),
  },
];

describe("search titles and descriptions", () => {
  it.each(PAGES)("$page fits what Google shows in full", ({ title, description }) => {
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    expect(`${title} ${description}`).not.toMatch(/[{}]/);
  });

  it("gives the prices and the trial length of the catalogue", () => {
    expect(t("Pricing.metaTitle", PRICING_META_VALUES)).toBe("Tarifs en FCFA, essai gratuit de 14 jours");
    expect(t("Pricing.metaDescription", PRICING_META_VALUES)).toMatch(
      /^Indépendant à 15\s000 et Cabinet à 49\s000 FCFA par mois, Pass Mission à 39\s000 FCFA/,
    );
    expect(t("Landing.metaDescription", LANDING_META_VALUES)).toContain("Essai gratuit de 14 jours.");
  });
});
