// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { JPEG_4X2, pngImage } from "@/lib/export/test-images";
import {
  EXPORT_IMAGE_LIMITS,
  imageFromBytes,
  loadExportImages,
  planImages,
  type ImageRow,
} from "./export-images";

// The bucket name comes from a module that loads the service-role client, never used here.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const MB = 1024 * 1024;
const WORKSPACE = "7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b";
const SECTION = "3a4b5c6d-7e8f-4a9b-8c0d-1e2f3a4b5c6d";
const OTHER_SECTION = "4b5c6d7e-8f9a-4b0c-9d1e-2f3a4b5c6d7e";

function id(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function row(index: number, patch: Partial<ImageRow> = {}): ImageRow {
  return {
    id: id(index),
    section_id: SECTION,
    storage_path: `${WORKSPACE}/${SECTION}/${index}.png`,
    mime_type: "image/png",
    size_bytes: 1000,
    ...patch,
  };
}

describe("planImages", () => {
  it("reads the images of the report and settles the others", () => {
    const rows = [row(1), row(2, { mime_type: "image/webp" }), row(3, { size_bytes: 11 * MB })];
    const { images, reads } = planImages([id(1), id(2), id(3), id(4)], rows);
    expect(reads.map((read) => read.id)).toEqual([id(1)]);
    expect(Object.fromEntries(images)).toEqual({
      [id(2)]: { status: "unavailable" },
      [id(3)]: { status: "tooLarge" },
      // Deleted, of another report, or hidden by RLS: not among the rows.
      [id(4)]: { status: "unavailable" },
    });
  });

  it("stops at 50 images and 40 MB, in reading order", () => {
    const many = Array.from({ length: 60 }, (_, index) => row(index));
    const counted = planImages(
      many.map((item) => item.id),
      many,
    );
    expect(counted.reads).toHaveLength(EXPORT_IMAGE_LIMITS.images);
    expect(counted.images.get(id(50))).toEqual({ status: "limit" });

    const heavy = Array.from({ length: 6 }, (_, index) => row(index, { size_bytes: 9 * MB }));
    const sized = planImages(
      heavy.map((item) => item.id),
      heavy,
    );
    expect(sized.reads.map((read) => read.id)).toEqual([id(0), id(1), id(2), id(3)]);
    expect(sized.images.get(id(4))).toEqual({ status: "limit" });
  });
});

describe("imageFromBytes", () => {
  it("keeps a PNG or JPEG of the recorded size and type, with its size in pixels", () => {
    const png = pngImage(30, 10);
    expect(imageFromBytes(png, { mime_type: "image/png", size_bytes: png.length })).toEqual({
      status: "ready",
      format: "png",
      data: png,
      width: 30,
      height: 10,
      orientation: 1,
    });
    expect(imageFromBytes(JPEG_4X2, { mime_type: "image/jpeg", size_bytes: JPEG_4X2.length })).toMatchObject({
      status: "ready",
      format: "jpeg",
      width: 4,
      height: 2,
    });
  });

  it("refuses bytes that are not what the upload recorded", () => {
    const png = pngImage(30, 10);
    expect(imageFromBytes(png, { mime_type: "image/jpeg", size_bytes: png.length })).toEqual({
      status: "unavailable",
    });
    expect(imageFromBytes(png, { mime_type: "image/png", size_bytes: png.length + 1 })).toEqual({
      status: "unavailable",
    });
    const junk = Buffer.from("pas une image");
    expect(imageFromBytes(junk, { mime_type: "image/png", size_bytes: junk.length })).toEqual({
      status: "unavailable",
    });
  });

  it("refuses an image of more than 40 megapixels, a decompression bomb for the PDF", () => {
    const bomb = pngImage(1, 1);
    bomb.writeUInt32BE(8000, 16);
    bomb.writeUInt32BE(6000, 20);
    expect(imageFromBytes(bomb, { mime_type: "image/png", size_bytes: bomb.length })).toEqual({
      status: "tooLarge",
    });
  });
});

/** A client that answers the lookup with `rows` and serves `files` by path. */
function fakeClient(rows: ImageRow[], files: Record<string, Buffer | null>) {
  const lookups: string[][] = [];
  const downloads: string[] = [];
  const query = {
    select: () => query,
    eq: (column: string, value: string) => {
      expect(column).toBe("workspace_id");
      expect(value).toBe(WORKSPACE);
      return query;
    },
    in: (_column: string, ids: string[]) => {
      lookups.push(ids);
      return query;
    },
    not: () =>
      Promise.resolve({ data: rows.filter((item) => lookups.at(-1)?.includes(item.id)), error: null }),
  };
  const client = {
    from: (table: string) => {
      expect(table).toBe("deliverables");
      return query;
    },
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("deliverables");
        return {
          download: async (path: string) => {
            downloads.push(path);
            const bytes = files[path];
            return bytes
              ? { data: new Blob([new Uint8Array(bytes)]), error: null }
              : { data: null, error: { message: "gone" } };
          },
        };
      },
    },
  };
  return { client: client as never, lookups, downloads };
}

describe("loadExportImages", () => {
  const ref = (index: number) => `![Image ${index}](/api/deliverables/${id(index)}/file)`;

  it("reads nothing for a report without images", async () => {
    const { client, lookups } = fakeClient([], {});
    const images = await loadExportImages(client, { workspace_id: WORKSPACE }, [
      { id: SECTION, markdown: "Pas d'image, seulement [un lien](/api/deliverables/x/file)." },
    ]);
    expect(images.size).toBe(0);
    expect(lookups).toEqual([]);
  });

  it("draws only the deliverables of the report's sections, read with the user's client", async () => {
    const png = pngImage(20, 10);
    const rows = [
      row(1, { size_bytes: png.length }),
      row(2, { size_bytes: png.length, section_id: OTHER_SECTION }),
      row(3, { size_bytes: png.length }),
    ];
    const { client, downloads } = fakeClient(rows, {
      [rows[0]!.storage_path]: png,
      [rows[1]!.storage_path]: png,
    });
    const images = await loadExportImages(client, { workspace_id: WORKSPACE }, [
      { id: SECTION, markdown: `${ref(1)}\n\n${ref(2)}\n\n${ref(3)}` },
    ]);
    expect(images.get(id(1))).toMatchObject({ status: "ready", width: 20, height: 10 });
    // A deliverable of another report of the workspace is never read.
    expect(images.get(id(2))).toEqual({ status: "unavailable" });
    expect(downloads).not.toContain(rows[1]!.storage_path);
    // The file is gone from storage.
    expect(images.get(id(3))).toEqual({ status: "unavailable" });
  });

  it("keeps the first PNG images within the pixel cap of the export", async () => {
    const big = pngImage(1, 1);
    // 6000 by 6000: 36 megapixels each, under the cap of one image.
    big.writeUInt32BE(6000, 16);
    big.writeUInt32BE(6000, 20);
    const rows = [1, 2, 3, 4].map((index) =>
      row(index, { size_bytes: big.length, storage_path: `${WORKSPACE}/${SECTION}/${index}.png` }),
    );
    const { client } = fakeClient(rows, Object.fromEntries(rows.map((item) => [item.storage_path, big])));
    const images = await loadExportImages(client, { workspace_id: WORKSPACE }, [
      { id: SECTION, markdown: [1, 2, 3, 4].map(ref).join("\n\n") },
    ]);
    expect([1, 2, 3, 4].map((index) => images.get(id(index))?.status)).toEqual([
      "ready",
      "ready",
      "limit",
      "limit",
    ]);
  });
});
