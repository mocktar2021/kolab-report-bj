// Draws the preview image that WhatsApp, LinkedIn, Facebook and X show for a
// link to a public page (KRB-258): the logo, the tagline of the landing page
// and the address, on the dark tile colour of the logo. 1200 by 630, the size
// those sites expect. Run it again after changing the tagline or the mark:
// `node scripts/generate-og-image.mjs`. It uses sharp, which comes with
// Next.js, and the Inter font installed on the machine (any sans-serif works).
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "public", "og", "kolabreport.png");

// Same colours as the dark cover of the sales deck.
const INK = "#0B0B0E";
const PAPER = "#FAFAF8";
const MUTED = "#C8C8CE";
const ACCENT = "#FF8975";

// The logo mark on its 32 by 32 grid, as in scripts/generate-icons.mjs.
const MARK = `<rect width="32" height="32" rx="9" fill="${PAPER}"/>
  <path d="M10 10.5h12M10 16h6.5M10 21.5h12" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="21" cy="16" r="1.6" fill="${INK}"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${INK}"/>
  <g transform="translate(80 72) scale(2.5)">${MARK}</g>
  <text x="180" y="125" font-family="Inter, sans-serif" font-size="44" font-weight="600" fill="${PAPER}">KolabReport</text>
  <text font-family="Inter, sans-serif" font-size="72" font-weight="600" fill="${PAPER}" letter-spacing="-1">
    <tspan x="80" y="318">Vos rapports à plusieurs</tspan>
    <tspan x="80" y="406">experts, rédigés ensemble.</tspan>
  </text>
  <text x="80" y="478" font-family="Inter, sans-serif" font-size="32" fill="${MUTED}">Une section par expert, l’IA pour le premier jet.</text>
  <text x="80" y="560" font-family="Inter, sans-serif" font-size="32" font-weight="600" fill="${ACCENT}">kolabreport.com</text>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
console.log(`Wrote ${path.relative(root, out)}`);
