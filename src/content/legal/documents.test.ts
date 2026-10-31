import { describe, expect, it } from "vitest";
import messages from "../../../messages/fr.json";
import { LEGAL_DOCUMENTS } from "./index";
import { LEGAL_PAGE_KEYS, LEGAL_PAGES } from "./pages";
import { linkTarget, parseRichText } from "./rich-text";
import type { LegalBlock, LegalDocument } from "./types";

// Static checks of the legal texts (KRB-159): stable anchors, links that
// lead somewhere, a valid date and no dash the writing rules forbid.

function blockTexts(block: LegalBlock): string[] {
  if (typeof block === "string") return [block];
  if ("list" in block) return block.list;
  if ("facts" in block) return block.facts.flat();
  return [block.table.caption, ...block.table.head, ...block.table.rows.flat()];
}

function documentTexts(document: LegalDocument): string[] {
  return [
    ...document.intro.flatMap(blockTexts),
    ...document.sections.flatMap((section) => [section.title, ...section.body.flatMap(blockTexts)]),
  ];
}

const anchors = new Map(
  LEGAL_PAGE_KEYS.map((key) => [
    LEGAL_PAGES[key] as string,
    new Set(LEGAL_DOCUMENTS[key].sections.map((section) => section.id)),
  ]),
);

describe.each(LEGAL_PAGE_KEYS)("legal page %s", (key) => {
  const document = LEGAL_DOCUMENTS[key];
  const texts = documentTexts(document);

  it("has a title and a description in messages/fr.json", () => {
    expect(messages.Legal.pages[key].title).not.toBe("");
    expect(messages.Legal.pages[key].description).not.toBe("");
    expect(messages.Legal.nav[key]).not.toBe("");
  });

  it("gives every section a unique, URL-safe anchor", () => {
    const ids = document.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("has a valid update date that is not in the future", () => {
    expect(document.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const date = new Date(`${document.updatedAt}T00:00:00Z`);
    expect(Number.isNaN(date.getTime())).toBe(false);
    expect(date.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("links only to existing pages and sections, or to https, mailto and tel addresses", () => {
    const broken: string[] = [];
    for (const text of texts) {
      for (const token of parseRichText(text)) {
        if (token.kind !== "link") continue;
        const target = linkTarget(token.href);
        if (!target) {
          broken.push(`${token.href} (not allowed)`);
        } else if (target.kind === "anchor" && !anchors.get(LEGAL_PAGES[key])?.has(target.hash)) {
          broken.push(`${token.href} (no such section)`);
        } else if (target.kind === "page") {
          const sections = anchors.get(target.path);
          if (!sections) broken.push(`${token.href} (not a legal page)`);
          else if (target.hash && !sections.has(target.hash)) broken.push(`${token.href} (no such section)`);
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

describe("mentions légales", () => {
  it("gives the publisher's phone as a link that opens the phone app", () => {
    const links = documentTexts(LEGAL_DOCUMENTS.mentionsLegales)
      .flatMap((text) => parseRichText(text))
      .filter((token) => token.kind === "link" && token.href.startsWith("tel:"));

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toEqual({
        kind: "link",
        text: "+229\u00a001\u00a069\u00a070\u00a062\u00a086",
        href: "tel:+2290169706286",
      });
    }
  });
});
