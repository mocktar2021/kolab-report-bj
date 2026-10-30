// @vitest-environment node
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../messages/fr.json";
import { GUIDE_FIGURES } from "@/content/guide/figures";
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from "@/lib/seo/copy";
import { INDEXED_PATHS } from "@/lib/seo/site";
import { findUseCase, solutionPath, USE_CASES, type PlanItem } from "./pages";

const t = createTranslator({ locale: "fr", messages });

function allText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allText);
  if (value && typeof value === "object") return Object.values(value).flatMap(allText);
  return [];
}

function countSections(items: readonly PlanItem[]): number {
  return items.reduce((total, item) => total + 1 + countSections(item.children ?? []), 0);
}

describe("use-case pages", () => {
  it("have distinct slugs, all in the sitemap", () => {
    const slugs = USE_CASES.map(({ slug }) => slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(INDEXED_PATHS).toContain(solutionPath(slug));
      expect(findUseCase(slug)?.slug).toBe(slug);
    }
    expect(findUseCase("inconnu")).toBeUndefined();
  });

  it.each(USE_CASES)("$slug fits what Google shows in full", ({ metaTitle, metaDescription }) => {
    const title = t("Metadata.titleTemplate").replace("%s", metaTitle);
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(metaDescription.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  it.each(USE_CASES)("$slug has every part of the page", (useCase) => {
    expect(useCase.audience.length).toBeGreaterThanOrEqual(2);
    expect(useCase.ai.length).toBeGreaterThanOrEqual(3);
    expect(countSections(useCase.plan)).toBeGreaterThanOrEqual(6);
    expect(GUIDE_FIGURES[useCase.figure]).toBeDefined();
    // A section with sub-sections has no author: each sub-section has one.
    const plan: readonly PlanItem[] = useCase.plan;
    for (const item of plan) {
      if (item.children) {
        expect(item.who).toBeUndefined();
        for (const child of item.children) expect(child.who).toBeTruthy();
      } else {
        expect(item.who).toBeTruthy();
      }
    }
  });

  it("uses French spacing and no em dash", () => {
    for (const text of allText(USE_CASES)) {
      expect(text).not.toContain("—");
      // A space before : ; ? ! is a no-break space in French.
      expect(text).not.toMatch(/ [:;?!]/);
    }
  });
});
