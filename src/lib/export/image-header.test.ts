// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fitSize, readImageHeader, shownSize, swapsSides } from "./image-header";
import { JPEG_4X2, PROGRESSIVE_JPEG_4X2, pngImage, withExifOrientation } from "./test-images";

/** A PNG whose header says width by height, without the pixels to back it. */
function pngHeader(width: number, height: number, depth = 8, colorType = 2): Buffer {
  const png = pngImage(1, 1);
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png[24] = depth;
  png[25] = colorType;
  return png;
}

describe("readImageHeader", () => {
  it("reads the size of a PNG from its IHDR chunk", () => {
    expect(readImageHeader(pngImage(12, 5))).toEqual({ format: "png", width: 12, height: 5, orientation: 1 });
    expect(readImageHeader(pngImage(3, 7, { alpha: true }))).toMatchObject({ width: 3, height: 7 });
  });

  it("reads the size of baseline and progressive JPEGs", () => {
    expect(readImageHeader(JPEG_4X2)).toEqual({ format: "jpeg", width: 4, height: 2, orientation: 1 });
    expect(readImageHeader(PROGRESSIVE_JPEG_4X2)).toEqual({
      format: "jpeg",
      width: 4,
      height: 2,
      orientation: 1,
    });
  });

  it("reads the Exif orientation of a JPEG, in both byte orders", () => {
    expect(readImageHeader(withExifOrientation(JPEG_4X2, 6))).toMatchObject({ width: 4, orientation: 6 });
    expect(readImageHeader(withExifOrientation(JPEG_4X2, 8, "II"))).toMatchObject({ orientation: 8 });
    // Out of range: as if there were none.
    expect(readImageHeader(withExifOrientation(JPEG_4X2, 9))).toMatchObject({ orientation: 1 });
  });

  it("refuses bytes that are neither PNG nor JPEG", () => {
    expect(readImageHeader(new Uint8Array())).toBeNull();
    expect(readImageHeader(Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"))).toBeNull();
    expect(readImageHeader(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBeNull();
    expect(readImageHeader(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    // A wrong byte in the PNG signature.
    const png = pngImage(2, 2);
    png[3] = 0x48;
    expect(readImageHeader(png)).toBeNull();
  });

  it("refuses a truncated file", () => {
    expect(readImageHeader(pngImage(2, 2).subarray(0, 24))).toBeNull();
    // Cut before the start of frame.
    const sof = JPEG_4X2.indexOf(Buffer.from([0xff, 0xc0]));
    expect(sof).toBeGreaterThan(0);
    expect(readImageHeader(JPEG_4X2.subarray(0, sof + 5))).toBeNull();
    expect(readImageHeader(JPEG_4X2.subarray(0, 3))).toBeNull();
  });

  it("refuses a JPEG segment that runs past the end of the file", () => {
    const broken = Buffer.from(JPEG_4X2);
    // The length of the first segment (APP0), made huge.
    broken.writeUInt16BE(0xfff0, 4);
    expect(readImageHeader(broken)).toBeNull();
  });

  it("refuses a JPEG whose image data comes before its size", () => {
    expect(readImageHeader(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6]))).toBeNull();
  });

  it("refuses sizes of zero and sizes past 100 000 pixels a side, and reads the rest", () => {
    expect(readImageHeader(pngHeader(0, 10))).toBeNull();
    expect(readImageHeader(pngHeader(200_000, 10))).toBeNull();
    expect(readImageHeader(pngHeader(0xffffffff, 0xffffffff))).toBeNull();
    // Huge but possible: the caps of the export apply to it.
    expect(readImageHeader(pngHeader(90_000, 90_000))).toMatchObject({ width: 90_000, height: 90_000 });
    const zeroHeight = Buffer.from(JPEG_4X2);
    const sof = zeroHeight.indexOf(Buffer.from([0xff, 0xc0]));
    zeroHeight.writeUInt16BE(0, sof + 5);
    expect(readImageHeader(zeroHeight)).toBeNull();
  });

  it("refuses a PNG with a bit depth its color type does not allow", () => {
    expect(readImageHeader(pngHeader(2, 2, 4, 2))).toBeNull();
    expect(readImageHeader(pngHeader(2, 2, 8, 5))).toBeNull();
  });
});

describe("image sizes", () => {
  it("swaps the sides of an image turned a quarter", () => {
    expect(swapsSides(1)).toBe(false);
    expect(swapsSides(3)).toBe(false);
    expect(swapsSides(6)).toBe(true);
    expect(shownSize({ width: 4032, height: 3024, orientation: 6 })).toEqual({ width: 3024, height: 4032 });
    expect(shownSize({ width: 4032, height: 3024, orientation: 1 })).toEqual({ width: 4032, height: 3024 });
  });

  it("fits an image in a box at its ratio, never past its own size", () => {
    expect(fitSize({ width: 4000, height: 3000 }, 600, 900, 1)).toEqual({ width: 600, height: 450 });
    expect(fitSize({ width: 1000, height: 4000 }, 600, 800, 1)).toEqual({ width: 200, height: 800 });
    expect(fitSize({ width: 100, height: 50 }, 600, 900, 1)).toEqual({ width: 100, height: 50 });
    expect(fitSize({ width: 100, height: 50 }, 600, 900, 0.75)).toEqual({ width: 75, height: 37.5 });
  });
});
