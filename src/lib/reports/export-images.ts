import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSectionImageType } from "@/lib/deliverables/section-images";
import { DELIVERABLES_BUCKET } from "@/lib/deliverables/server";
import { readImageHeader } from "@/lib/export/image-header";
import { sectionImageIds } from "@/lib/export/markdown";
import type { ExportImage } from "@/lib/export/types";
import { log } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";

// The images of an export (KRB-216): the deliverables the sections' text
// shows, read with the rights of the person exporting (RLS on the table and
// on the bucket), never with the service role. Only deliverables of the
// report's own sections count. The builders then draw what is here and show
// the caption of everything else.

export const EXPORT_IMAGE_LIMITS = {
  /** Bytes of one image. */
  imageBytes: 10 * 1024 * 1024,
  /** Pixels of one image. Past this, a PNG takes too much memory once the PDF renderer decodes it. */
  imagePixels: 40_000_000,
  /** Images in one export. */
  images: 50,
  /** Bytes of all the images of one export. */
  totalBytes: 40 * 1024 * 1024,
  /**
   * Pixels of all the PNG images of one export. The PDF renderer decodes a
   * PNG with transparency to about 12 bytes a pixel, so a few small files can
   * still ask for gigabytes. It never decodes a JPEG.
   */
  pngPixels: 100_000_000,
} as const;

/** Images looked up at most, in reading order. Past the caps anyway, the rest are not read. */
const LOOKED_UP = 100;
/** Ids per lookup, to keep the request address short. */
const LOOKUP_CHUNK = 50;
/** Downloads at once. */
const PARALLEL_READS = 4;
const READ_TIMEOUT_MS = 20_000;

type Client = SupabaseClient<Database>;

export type ImageRow = {
  id: string;
  section_id: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
};

/**
 * What happens to each image before anything is downloaded, in reading
 * order: `reads` are the files to download, `images` the ones already
 * settled. `rows` are the deliverables found, already limited to the report.
 */
export function planImages(
  ids: readonly string[],
  rows: readonly ImageRow[],
): { images: Map<string, ExportImage>; reads: ImageRow[] } {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const images = new Map<string, ExportImage>();
  const reads: ImageRow[] = [];
  let total = 0;
  ids.forEach((id, index) => {
    const row = byId.get(id);
    if (index >= LOOKED_UP) images.set(id, { status: "limit" });
    else if (!row || !isSectionImageType(row.mime_type)) images.set(id, { status: "unavailable" });
    else if (row.size_bytes > EXPORT_IMAGE_LIMITS.imageBytes) images.set(id, { status: "tooLarge" });
    else if (
      reads.length >= EXPORT_IMAGE_LIMITS.images ||
      total + row.size_bytes > EXPORT_IMAGE_LIMITS.totalBytes
    ) {
      images.set(id, { status: "limit" });
    } else {
      reads.push(row);
      total += row.size_bytes;
    }
  });
  return { images, reads };
}

/**
 * The image in `bytes`, checked against its row and the caps of one image:
 * the bytes must be the size and the type the upload recorded, and their
 * header readable.
 */
export function imageFromBytes(bytes: Buffer, row: Pick<ImageRow, "mime_type" | "size_bytes">): ExportImage {
  if (bytes.length > EXPORT_IMAGE_LIMITS.imageBytes) return { status: "tooLarge" };
  if (bytes.length === 0 || bytes.length !== row.size_bytes) return { status: "unavailable" };
  const header = readImageHeader(bytes);
  if (!header || `image/${header.format}` !== row.mime_type) return { status: "unavailable" };
  if (header.width * header.height > EXPORT_IMAGE_LIMITS.imagePixels) return { status: "tooLarge" };
  return { status: "ready", data: bytes, ...header };
}

/** The deliverables among `ids` that `supabase` can read, uploaded, in the given sections. */
async function findRows(
  supabase: Client,
  workspaceId: string,
  ids: readonly string[],
  sectionIds: ReadonlySet<string>,
): Promise<ImageRow[] | null> {
  const rows: ImageRow[] = [];
  for (let start = 0; start < ids.length; start += LOOKUP_CHUNK) {
    const { data, error } = await supabase
      .from("deliverables")
      .select("id, section_id, storage_path, mime_type, size_bytes")
      .eq("workspace_id", workspaceId)
      .in("id", ids.slice(start, start + LOOKUP_CHUNK))
      .not("uploaded_at", "is", null);
    if (error || !data) {
      log.error("exports: could not look up the images", { error: error?.message });
      return null;
    }
    // A deliverable of another report of the workspace is not drawn.
    rows.push(...data.filter((row) => sectionIds.has(row.section_id)));
  }
  return rows;
}

async function readFile(supabase: Client, row: ImageRow): Promise<Buffer | null> {
  const { data, error } = await supabase.storage
    .from(DELIVERABLES_BUCKET)
    .download(row.storage_path, undefined, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
  if (error || !data) {
    log.warn("exports: could not read an image", { error: error?.message });
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

/**
 * The images the sections show, by deliverable id. Every id the text shows
 * gets an entry; a read that fails leaves the image unavailable rather than
 * failing the export.
 */
export async function loadExportImages(
  supabase: Client,
  report: { workspace_id: string },
  sections: readonly { id: string; markdown: string | null }[],
): Promise<Map<string, ExportImage>> {
  const ids = [...new Set(sections.flatMap((section) => sectionImageIds(section.markdown)))];
  if (ids.length === 0) return new Map();
  const sectionIds = new Set(sections.map((section) => section.id));
  const rows = await findRows(supabase, report.workspace_id, ids.slice(0, LOOKED_UP), sectionIds);
  const { images, reads } = planImages(ids, rows ?? []);

  const files: (Buffer | null)[] = new Array(reads.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < reads.length) {
      const index = next++;
      files[index] = await readFile(supabase, reads[index]!).catch(() => null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_READS, reads.length) }, worker));

  // In reading order, so the PNG cap keeps the first images.
  let pngPixels = 0;
  reads.forEach((row, index) => {
    const bytes = files[index];
    const image: ExportImage = bytes ? imageFromBytes(bytes, row) : { status: "unavailable" };
    if (image.status === "ready" && image.format === "png") {
      pngPixels += image.width * image.height;
      if (pngPixels > EXPORT_IMAGE_LIMITS.pngPixels) {
        pngPixels -= image.width * image.height;
        images.set(row.id, { status: "limit" });
        return;
      }
    }
    images.set(row.id, image);
  });
  return images;
}
