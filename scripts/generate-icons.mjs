// Draws the favicon and the app icons from the logo mark
// (src/components/brand/logo.tsx): a dark rounded square with three section
// lines, the middle one still being written. Run it again after changing the
// mark: `node scripts/generate-icons.mjs`. It uses sharp, which comes with
// Next.js.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");

// Same values as the light and dark theme in src/app/globals.css:
// --foreground and --background.
const LIGHT = { tile: "#09090B", mark: "#FAFAFA" };
const DARK = { tile: "#FFFFFF", mark: "#0E0E0E" };

// The mark on its 32 by 32 grid, as in the LogoMark component.
const LINES = "M10 10.5h12M10 16h6.5M10 21.5h12";
const STROKE = 2.5;
const DOT = { cx: 21, cy: 16, r: 1.6 };

/**
 * `rounded`: the tile keeps the logo's rounded corners (browser tab, desktop
 * install). Without it the tile fills the square, for platforms that cut
 * their own shape (iOS, Android maskable icons).
 */
function markSvg({ size, colors = LIGHT, rounded = true }) {
  const radius = rounded ? 9 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="${radius}" fill="${colors.tile}"/>
  <path d="${LINES}" fill="none" stroke="${colors.mark}" stroke-width="${STROKE}" stroke-linecap="round"/>
  <circle cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}" fill="${colors.mark}"/>
</svg>
`;
}

/**
 * The mark redrawn on the 16 pixel grid for the smallest favicon. Scaled down
 * from 32, the 1.25 pixel lines fall between rows and turn into grey smudges.
 */
function tinySvg() {
  const bar = (x, y, width) => `<rect x="${x}" y="${y}" width="${width}" height="2" fill="${LIGHT.mark}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
  <rect width="16" height="16" rx="4.5" fill="${LIGHT.tile}"/>
  <g shape-rendering="crispEdges">${bar(4, 4, 8)}${bar(4, 7, 4)}${bar(10, 7, 2)}${bar(4, 10, 8)}</g>
</svg>
`;
}

/** The browser tab icon: follows the light or dark setting of the device. */
function adaptiveSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <style>
    .tile { fill: ${LIGHT.tile} }
    .line { stroke: ${LIGHT.mark} }
    .dot { fill: ${LIGHT.mark} }
    @media (prefers-color-scheme: dark) {
      .tile { fill: ${DARK.tile} }
      .line { stroke: ${DARK.mark} }
      .dot { fill: ${DARK.mark} }
    }
  </style>
  <rect class="tile" width="32" height="32" rx="9"/>
  <path class="line" d="${LINES}" fill="none" stroke-width="${STROKE}" stroke-linecap="round"/>
  <circle class="dot" cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}"/>
</svg>
`;
}

function png(svg) {
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

/** An .ico file holding PNG images, which every current browser reads. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

const outputs = {
  "public/icons/icon.svg": adaptiveSvg(),
  "public/favicon.ico": ico([
    { size: 16, data: await png(tinySvg()) },
    { size: 32, data: await png(markSvg({ size: 32 })) },
    { size: 48, data: await png(markSvg({ size: 48 })) },
  ]),
  "public/icons/icon-192.png": await png(markSvg({ size: 192 })),
  "public/icons/icon-512.png": await png(markSvg({ size: 512 })),
  // The mark fits well inside the maskable safe zone (the central circle of
  // 80 percent), so only the corners change.
  "public/icons/icon-maskable-512.png": await png(markSvg({ size: 512, rounded: false })),
  "public/icons/apple-touch-icon.png": await png(markSvg({ size: 180, rounded: false })),
};

for (const [file, content] of Object.entries(outputs)) {
  await writeFile(path.join(root, file), content);
  console.log(`wrote ${file}`);
}
