import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import messages from "../../../messages/fr.json";
import { LEGAL_DOCUMENTS } from "@/content/legal";
import { LEGAL_PAGE_KEYS, LEGAL_PAGES } from "@/content/legal/pages";
import { linkTarget, parseRichText } from "@/content/legal/rich-text";
import { FIGURE_MAX_BYTES, GUIDE_FIGURES, figureSrc, type GuideFigureKey } from "./figures";
import { GUIDE } from "./index";
import { GUIDE_PATH, GUIDE_PDF_PATH } from "./pages";
import type { GuideBlock } from "./types";

// Static checks of the user guide (KRB-199): stable anchors, links that a
// signed-out reader can open, screenshots that exist with an alt text and a
// small size, the PDF, and no dash the writing rules forbid.

const PUBLIC = path.join(process.cwd(), "public");

function blockTexts(block: GuideBlock): string[] {
  if (typeof block === "string") return [block];
  if ("list" in block) return block.list;
  if ("steps" in block) return block.steps;
  if ("figure" in block) return [block.caption];
  if ("facts" in block) return block.facts.flat();
  return [block.table.caption, ...block.table.head, ...block.table.rows.flat()];
}

const blocks: GuideBlock[] = [
  ...GUIDE.intro,
  ...GUIDE.parts.flatMap((part) => [...part.intro, ...part.sections.flatMap((section) => section.body)]),
];
const texts = [
  ...blocks.flatMap(blockTexts),
  ...GUIDE.parts.flatMap((part) => [part.title, ...part.sections.map((section) => section.title)]),
];
const anchors = GUIDE.parts.flatMap((part) => [part.id, ...part.sections.map((section) => section.id)]);
const usedFigures = blocks.flatMap((block) =>
  typeof block === "object" && "figure" in block ? [block.figure] : [],
);

/**
 * Pages a signed-out reader can open from the guide (public in
 * src/middleware.ts), with the anchors of the legal pages.
 */
const PUBLIC_PAGES = new Map<string, Set<string> | null>([
  ["/inscription", null],
  ["/connexion", null],
  ["/tarifs", null],
  [GUIDE_PATH, new Set(anchors)],
  ...LEGAL_PAGE_KEYS.map(
    (key) =>
      [
        LEGAL_PAGES[key] as string,
        new Set(LEGAL_DOCUMENTS[key].sections.map((section) => section.id)),
      ] as const,
  ),
]);

describe("user guide", () => {
  it("has its strings in messages/fr.json and links in the app menu and the public footer", () => {
    for (const key of ["metaTitle", "metaDescription", "title", "toc", "pdf", "updatedAt"] as const) {
      expect(messages.Guide[key]).not.toBe("");
    }
    expect(messages.AppShell.guide).not.toBe("");
    expect(messages.Landing.footer.guide).not.toBe("");
  });

  it("has a part per role, then the questions", () => {
    expect(GUIDE.parts.map((part) => part.title)).toEqual([
      "Propriétaire et administrateur",
      "Expert",
      "Questions fréquentes",
    ]);
    for (const part of GUIDE.parts) expect(part.sections.length).toBeGreaterThan(0);
  });

  it("gives every part and section a unique, URL-safe anchor", () => {
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const id of anchors) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("has a valid update date that is not in the future", () => {
    expect(GUIDE.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const date = new Date(`${GUIDE.updatedAt}T00:00:00Z`);
    expect(Number.isNaN(date.getTime())).toBe(false);
    expect(date.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("links only to its own sections, public pages, or https and mailto addresses", () => {
    const broken: string[] = [];
    for (const text of texts) {
      for (const token of parseRichText(text)) {
        if (token.kind !== "link") continue;
        const target = linkTarget(token.href);
        if (!target) {
          broken.push(`${token.href} (not allowed)`);
        } else if (target.kind === "anchor" && !anchors.includes(target.hash)) {
          broken.push(`${token.href} (no such section)`);
        } else if (target.kind === "page") {
          if (!PUBLIC_PAGES.has(target.path)) broken.push(`${token.href} (not a public page)`);
          const sections = PUBLIC_PAGES.get(target.path);
          if (target.hash && !sections?.has(target.hash)) broken.push(`${token.href} (no such section)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("leaves no unparsed mark in the text", () => {
    const leftovers = texts.flatMap((text) =>
      parseRichText(text)
        .filter((token) => token.kind === "text" && /\]\(|\*\*|`/.test(token.text))
        .map((token) => token.text),
    );
    expect(leftovers).toEqual([]);
  });

  it("uses no em dash or en dash", () => {
    expect(texts.filter((text) => /[\u2013\u2014\u2015]/.test(text))).toEqual([]);
  });
});

describe("screenshots", () => {
  it("shows every screenshot of the list at least once", () => {
    expect(new Set(usedFigures)).toEqual(new Set(Object.keys(GUIDE_FIGURES)));
  });

  it.each(Object.keys(GUIDE_FIGURES) as GuideFigureKey[])(
    "%s has a French alt text and a light WebP file",
    (key) => {
      const figure = GUIDE_FIGURES[key];
      expect(figure.alt.length).toBeGreaterThan(30);
      expect(figure.alt).not.toMatch(/\.webp|capture|screenshot/i);
      expect(figure.file).toMatch(/^[a-z0-9-]+\.webp$/);
      const file = path.join(PUBLIC, figureSrc(key));
      const bytes = readFileSync(file);
      // RIFF....WEBP
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(bytes.length).toBeLessThanOrEqual(FIGURE_MAX_BYTES);
    },
  );
});

describe("PDF", () => {
  it("is in public/ at the path the page links to", () => {
    const bytes = readFileSync(path.join(PUBLIC, GUIDE_PDF_PATH));
    expect(bytes.length).toBeGreaterThan(10_000);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
