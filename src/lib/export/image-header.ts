// Reads what the exports need to know about an image in a section (KRB-216)
// from its first bytes: PNG or JPEG, its size in pixels and, for a JPEG, the
// Exif orientation phones write instead of turning the pixels. Every read is
// checked against the length of the bytes, and nothing is decoded.

export type ImageFormat = "png" | "jpeg";

export type ImageHeader = {
  format: ImageFormat;
  /** Pixels as stored, before the orientation. */
  width: number;
  height: number;
  /** Exif orientation, 1 to 8. 1 for a PNG, or a JPEG without one. */
  orientation: number;
};

/** Sides past this are refused: PNG allows 2^31 - 1, and no camera comes near. */
const MAX_SIDE = 100_000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Bit depths allowed for each PNG color type. */
const PNG_DEPTHS: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

function u16(bytes: Uint8Array, at: number, little = false): number {
  return little ? bytes[at]! | (bytes[at + 1]! << 8) : (bytes[at]! << 8) | bytes[at + 1]!;
}

function u32(bytes: Uint8Array, at: number, little = false): number {
  return little
    ? (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0
    : ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
}

function validSide(value: number): boolean {
  return value > 0 && value <= MAX_SIDE;
}

/** The IHDR chunk, which a PNG must start with. */
function readPng(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return null;
  // Length 13, then "IHDR".
  if (u32(bytes, 8) !== 13 || u32(bytes, 12) !== 0x49484452) return null;
  const width = u32(bytes, 16);
  const height = u32(bytes, 20);
  const depth = bytes[24]!;
  const colorType = bytes[25]!;
  const [compression, filter, interlace] = [bytes[26], bytes[27], bytes[28]];
  if (!validSide(width) || !validSide(height)) return null;
  if (!PNG_DEPTHS[colorType]?.includes(depth)) return null;
  if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) return null;
  return { format: "png", width, height, orientation: 1 };
}

/** The orientation tag (0x0112) of IFD0 in an Exif payload, or 1. */
function exifOrientation(bytes: Uint8Array, start: number, end: number): number {
  // "Exif\0\0", then a TIFF header: "II" or "MM", 42, the offset of IFD0.
  const tiff = start + 6;
  if (end - tiff < 8) return 1;
  const order = u16(bytes, tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return 1;
  const little = order === 0x4949;
  if (u16(bytes, tiff + 2, little) !== 42) return 1;
  const ifd = tiff + u32(bytes, tiff + 4, little);
  if (ifd < tiff + 8 || ifd + 2 > end) return 1;
  const count = u16(bytes, ifd, little);
  for (let index = 0; index < count; index++) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) return 1;
    if (u16(bytes, entry, little) !== 0x0112) continue;
    // A SHORT, its value in the first two bytes of the value field.
    if (u16(bytes, entry + 2, little) !== 3) return 1;
    const value = u16(bytes, entry + 8, little);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

/** Start of frame markers: baseline, progressive and the rarer codings. Not DHT, JPG or DAC. */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** The markers up to the first start of frame, which holds the size. */
function readJpeg(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let orientation = 1;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    // Fill bytes: any number of 0xff before the marker.
    let markerAt = at + 1;
    while (markerAt < bytes.length && bytes[markerAt] === 0xff) markerAt++;
    if (markerAt + 2 >= bytes.length) return null;
    const marker = bytes[markerAt]!;
    // Markers without a length: TEM and the restart markers.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at = markerAt + 1;
      continue;
    }
    // The image data or its end, before any size: not an image we can draw.
    if (marker === 0xda || marker === 0xd9 || marker === 0xd8) return null;
    const length = u16(bytes, markerAt + 1);
    const start = markerAt + 3;
    const end = markerAt + 1 + length;
    if (length < 2 || end > bytes.length) return null;
    if (isStartOfFrame(marker)) {
      // Precision, then the height and the width.
      if (length < 8) return null;
      const height = u16(bytes, start + 1);
      const width = u16(bytes, start + 3);
      // A height of 0 comes later in a DNL marker, which the PDF renderer does not read.
      if (!validSide(width) || !validSide(height)) return null;
      return { format: "jpeg", width, height, orientation };
    }
    // APP1 with an Exif payload. The first one counts.
    if (
      marker === 0xe1 &&
      orientation === 1 &&
      end - start >= 6 &&
      u32(bytes, start) === 0x45786966 &&
      u16(bytes, start + 4) === 0
    ) {
      orientation = exifOrientation(bytes, start, end);
    }
    at = end;
  }
  return null;
}

/** The format and size of a PNG or JPEG from its bytes, or null when they are neither or are damaged. */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes[0] === 0x89) return readPng(bytes);
  if (bytes[0] === 0xff) return readJpeg(bytes);
  return null;
}

/** Orientations that turn the image a quarter turn: width and height swap on screen. */
export function swapsSides(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/** The size the image shows at, once its orientation is applied. */
export function shownSize(header: Pick<ImageHeader, "width" | "height" | "orientation">) {
  return swapsSides(header.orientation)
    ? { width: header.height, height: header.width }
    : { width: header.width, height: header.height };
}

/**
 * The largest size, at the image's ratio, that fits in maxWidth by
 * maxHeight, never larger than `natural` times the image: a small logo is
 * not blown up past its own size.
 */
export function fitSize(
  size: { width: number; height: number },
  maxWidth: number,
  maxHeight: number,
  natural: number,
): { width: number; height: number } {
  const scale = Math.min(maxWidth / size.width, maxHeight / size.height, natural);
  return { width: size.width * scale, height: size.height * scale };
}
