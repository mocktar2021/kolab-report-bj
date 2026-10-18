import { describe, expect, it } from "vitest";
import { sectionBlocks } from "@/lib/export/markdown";
import {
  captionFromFileName,
  insertBlock,
  isSectionImageFile,
  isSectionImageType,
  sectionImageFile,
  sectionImageId,
  sectionImageMarkdown,
  sectionImagePath,
  sectionImageSrc,
  transferredFiles,
} from "./section-images";

const ID = "0b6f5e1c-2d3a-4b5c-8d9e-0f1a2b3c4d5e";

/** Enough of a DataTransfer for the paste and drop checks. */
function transfer(files: File[], data: Record<string, string> = {}): DataTransfer {
  return { files, getData: (type: string) => data[type] ?? "" } as unknown as DataTransfer;
}

describe("sectionImageId", () => {
  it("reads the deliverable of its own file route", () => {
    expect(sectionImageId(`/api/deliverables/${ID}/file`)).toBe(ID);
    expect(sectionImageId(sectionImagePath(ID))).toBe(ID);
  });

  it("refuses every other address, so nothing else is ever fetched", () => {
    for (const url of [
      `https://evil.example/api/deliverables/${ID}/file`,
      `//evil.example/api/deliverables/${ID}/file`,
      `/api/deliverables/${ID}/file?x=1`,
      `/api/deliverables/${ID}/file#top`,
      `/api/deliverables/${ID}/file/`,
      `/api/deliverables/${ID.toUpperCase()}/file`,
      `/api/deliverables/${ID}/complete`,
      `/api/exports/${ID}`,
      `api/deliverables/${ID}/file`,
      `/api/deliverables/../${ID}/file`,
      ` /api/deliverables/${ID}/file`,
      "data:image/png;base64,AAAA",
      "",
      null,
      undefined,
    ]) {
      expect(sectionImageId(url), String(url)).toBeNull();
    }
  });

  it("loads images through the route in its PNG and JPEG mode", () => {
    expect(sectionImageSrc(ID)).toBe(`/api/deliverables/${ID}/file?image`);
  });
});

describe("section image types", () => {
  it("draws PNG and JPEG only", () => {
    expect(isSectionImageType("image/png")).toBe(true);
    expect(isSectionImageType("image/jpeg")).toBe(true);
    for (const type of ["image/webp", "image/gif", "image/svg+xml", "application/vnd.jgraph.mxfile"]) {
      expect(isSectionImageType(type)).toBe(false);
    }
    expect(isSectionImageFile("Façade.JPG")).toBe(true);
    expect(isSectionImageFile("plan.jpeg")).toBe(true);
    expect(isSectionImageFile("schema.svg")).toBe(false);
    expect(isSectionImageFile("schema.drawio")).toBe(false);
  });

  it("names a pasted screenshot after its type", () => {
    const blob = new File(["x"], "blob", { type: "image/png" });
    expect(sectionImageFile(blob)?.name).toBe("blob.png");
    expect(sectionImageFile(new File(["x"], "", { type: "image/jpeg" }))?.name).toBe("image.jpg");
    const named = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    expect(sectionImageFile(named)).toBe(named);
    expect(sectionImageFile(new File(["x"], "anim.gif", { type: "image/gif" }))).toBeNull();
    expect(sectionImageFile(new File(["x"], "notes.txt", { type: "text/plain" }))).toBeNull();
  });
});

describe("sectionImageMarkdown", () => {
  it("writes the image as its file route, the caption escaped so it reads back as written", () => {
    expect(sectionImageMarkdown(ID, "Façade nord")).toBe(`![Façade nord](/api/deliverables/${ID}/file)`);
    const caption = "Plan [v2] *final* <b>&amp; \\";
    const markdown = sectionImageMarkdown(ID, caption);
    expect(sectionBlocks(markdown)).toEqual([{ type: "image", id: ID, caption }]);
  });

  it("takes the file name as the default caption", () => {
    expect(captionFromFileName("Façade_nord_2026.JPG")).toBe("Façade nord 2026");
    expect(captionFromFileName("photo.chantier.png")).toBe("photo.chantier");
    expect(captionFromFileName(`${"a".repeat(300)}.png`)).toHaveLength(200);
  });
});

describe("insertBlock", () => {
  const image = "![x](/api/deliverables/x/file)";

  it("puts the block in a paragraph of its own", () => {
    expect(insertBlock("", 0, 0, image)).toEqual({ text: image, cursor: image.length });
    expect(insertBlock("Avant", 5, 5, image).text).toBe(`Avant\n\n${image}`);
    expect(insertBlock("Avant\n", 6, 6, image).text).toBe(`Avant\n\n${image}`);
    expect(insertBlock("Avant\n\nAprès", 7, 7, image).text).toBe(`Avant\n\n${image}\n\nAprès`);
    expect(insertBlock("Avant après", 6, 6, image).text).toBe(`Avant \n\n${image}\n\naprès`);
  });

  it("returns the position right after the block, and keeps the bounds in the text", () => {
    const { text, cursor } = insertBlock("Un\n\nDeux", 2, 2, image);
    expect(text.slice(0, cursor)).toBe(`Un\n\n${image}`);
    expect(insertBlock("abc", -4, 99, image).text).toBe(image);
  });
});

describe("transferredFiles", () => {
  const png = new File(["x"], "capture.png", { type: "image/png" });

  it("takes the files of a screenshot, a copied image or a drop from the computer", () => {
    expect(transferredFiles(transfer([png]))).toEqual([png]);
    expect(
      transferredFiles(transfer([png], { "text/html": '<meta charset="utf-8"><img src="x.png">' })),
    ).toEqual([png]);
    expect(transferredFiles(transfer([png], { "text/plain": "capture.png" }))).toEqual([png]);
  });

  it("leaves a copied text to the editor, even with a picture of it", () => {
    expect(transferredFiles(transfer([]))).toBeNull();
    expect(transferredFiles(null)).toBeNull();
    // Word and Excel put a picture of the copied text next to it.
    expect(transferredFiles(transfer([png], { "text/plain": "Tableau des mesures" }))).toBeNull();
    expect(
      transferredFiles(transfer([png], { "text/html": "<style>p{}</style><p></p>", "text/plain": "" })),
    ).toBeNull();
    expect(transferredFiles(transfer([png], { "text/html": "<p>Texte</p>" }))).toBeNull();
  });
});
