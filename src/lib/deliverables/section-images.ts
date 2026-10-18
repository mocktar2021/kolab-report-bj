// Images in a section's text (KRB-216). An image is always a deliverable of
// the section, PNG or JPEG, written in the Markdown as the address of its
// file route and nothing else:
//
//   ![Façade nord](/api/deliverables/0b6f…/file)
//
// That route checks the reader's rights (RLS) before it redirects to a
// signed link, so the text holds no link that outlives a change of rights.
// Any other image address (another site, another route, a query string) is
// never fetched: the app and the exports show its caption only.

/** The only image address the app draws: the file route of one deliverable, path only. */
const REFERENCE =
  /^\/api\/deliverables\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/file$/;

/** The id of the deliverable an image address points at, or null for any other address. */
export function sectionImageId(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  return REFERENCE.exec(url)?.[1] ?? null;
}

/** The address written in the Markdown for a deliverable. */
export function sectionImagePath(id: string): string {
  return `/api/deliverables/${id}/file`;
}

/** What an <img> loads: the same route, which then only answers for a PNG or a JPEG, shown inline. */
export function sectionImageSrc(id: string): string {
  return `${sectionImagePath(id)}?image`;
}

/** The types drawn in the text. WebP, GIF, SVG and diagrams stay downloads. */
export const SECTION_IMAGE_TYPES: readonly string[] = ["image/png", "image/jpeg"];

export function isSectionImageType(mimeType: string): boolean {
  return SECTION_IMAGE_TYPES.includes(mimeType);
}

/** Whether a file picked, pasted or dropped can go in the text, by its name like the upload checks. */
export function isSectionImageFile(name: string): boolean {
  return /\.(?:png|jpe?g)$/i.test(name);
}

/** Captions longer than this are cut: the caption is one line under the image. */
export const CAPTION_MAX_CHARS = 200;

/** The default caption of a file: its name without the extension, "_" as spaces. */
export function captionFromFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return base.replace(/_/g, " ").replace(/\s+/g, " ").trim().slice(0, CAPTION_MAX_CHARS);
}

/**
 * The Markdown image of a deliverable. The caption is escaped so it reads
 * back as written: no emphasis, link or entity comes out of a file name.
 */
export function sectionImageMarkdown(id: string, caption: string): string {
  const text = caption
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CAPTION_MAX_CHARS)
    .replace(/[\\`*_[\]<>&~|]/g, "\\$&");
  return `![${text}](${sectionImagePath(id)})`;
}

/**
 * The text with `block` put in place of [start, end), as a paragraph of its
 * own: a blank line before and after it, unless the text already has one
 * there. Returns the new text and the position right after the block.
 */
export function insertBlock(
  text: string,
  start: number,
  end: number,
  block: string,
): { text: string; cursor: number } {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  const before = text.slice(0, from);
  const after = text.slice(to);
  const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const tail = after === "" || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const head = `${before}${lead}${block}`;
  return { text: `${head}${tail}${after}`, cursor: head.length };
}

/**
 * Whether an HTML clipboard is a copied image: it has an <img>. The HTML is
 * only looked at, never parsed or shown. HTML without one, such as Word's
 * <style> and an empty paragraph, is a copied text.
 */
function htmlIsImage(html: string): boolean {
  return /<img\b/i.test(html);
}

/**
 * The files a paste or a drop carries, or null when it carries text to
 * paste as usual. Word and Excel put a picture of the copied text next to
 * it: that paste stays text. A copied image, a screenshot or files dropped
 * from the computer come with no text but their names.
 */
export function transferredFiles(data: DataTransfer | null): File[] | null {
  const files = Array.from(data?.files ?? []);
  if (!data || files.length === 0) return null;
  const names = new Set(files.map((file) => file.name));
  const text = data.getData("text/plain").trim();
  if (text && !text.split(/\r?\n/).every((line) => names.has(line.trim()))) return null;
  const html = data.getData("text/html");
  if (!text && html.trim() && !htmlIsImage(html)) return null;
  return files;
}

/**
 * The file under a name the upload accepts, or null when it is not a PNG or
 * a JPEG. A pasted screenshot can come without the extension of its type.
 */
export function sectionImageFile(file: File): File | null {
  if (isSectionImageFile(file.name)) return file;
  const extension = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : null;
  if (!extension) return null;
  const base = file.name.replace(/\.[^.]*$/, "").trim() || "image";
  return new File([file], `${base}.${extension}`, { type: file.type, lastModified: file.lastModified });
}
