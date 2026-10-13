import { describe, expect, it } from "vitest";
import { matchesSignature, svgHasActiveContent, xmlRootName } from "./sniff";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

// Start of an Illustrator export: a DOCTYPE that declares namespace entities.
const ILLUSTRATOR = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
\t<!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">
\t<!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">
]>
<svg version="1.1" xmlns:x="&ns_extend;" xmlns:i="&ns_ai;"><g i:extraneous="self"><rect width="4"/></g></svg>`;

describe("matchesSignature", () => {
  it.each([
    ["zip", bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00)],
    ["ole", bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00)],
    ["pdf", text("%PDF-1.7\n%âãÏÓ")],
    ["pdf", text("\n\n%PDF-1.4")],
    ["png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00)],
    ["jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)],
    ["webp", text("RIFF\x24\x00\x00\x00WEBPVP8 ")],
    ["svg", text('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ["svg", text('﻿<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg width="1">')],
    ["drawio", text('<mxfile host="app.diagrams.net"><diagram>')],
    ["drawio", text('<?xml version="1.0" encoding="UTF-8"?>\n<mxGraphModel dx="1">')],
    ["svg", text(ILLUSTRATOR)],
    ["text", text("Nom;Montant\nÉtude;1200\n")],
    ["text", bytes(0x4e, 0x6f, 0x6d, 0x3b, 0xc9, 0x74, 0x75, 0x64, 0x65)], // Windows-1252 "Nom;Étude"
    ["text", bytes(0xff, 0xfe, 0x4e, 0x00, 0x6f, 0x00)], // UTF-16 with a byte order mark
  ] as const)("accepts a real %s header", (signature, head) => {
    expect(matchesSignature(signature, head)).toBe(true);
  });

  const exe = bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00);
  const html = text("<!doctype html><script>alert(1)</script>");

  it.each([
    ["zip", exe],
    ["zip", html],
    ["ole", exe],
    ["pdf", html],
    ["pdf", text(`${" ".repeat(2000)}%PDF-1.4`)],
    ["png", text("not a png")],
    ["jpeg", bytes(0xff, 0xd8)],
    ["webp", text("RIFF\x24\x00\x00\x00WAVEfmt ")],
    ["svg", html],
    ["drawio", text("<svg></svg>")],
    ["text", exe],
  ] as const)("refuses a %s that is something else", (signature, head) => {
    expect(matchesSignature(signature, head)).toBe(false);
  });

  it("refuses an empty file", () => {
    expect(matchesSignature("zip", new Uint8Array())).toBe(false);
  });
});

describe("svgHasActiveContent", () => {
  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#c00"/></svg>',
    '<svg><image href="data:image/png;base64,iVBORw0KGgo="/></svg>',
    '<svg><a xlink:href="https://kolabreport.com"><text>Site</text></a></svg>',
    // draw.io exports wrap labels in foreignObject.
    '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Serveur</div></foreignObject></svg>',
    '<svg><text font-family="Inter">Réunion</text></svg>',
    ILLUSTRATOR,
    "<svg><text>one = 1, onload = demain</text></svg>",
    '<svg xmlns:sodipodi="x" xmlns:inkscape="y" sodipodi:docname="a.svg"><sodipodi:namedview inkscape:zoom="1"/><style>.a{fill:red}</style><path class="a" d="M0 0"/></svg>',
    "<svg><!-- <script>alert(1)</script> --><rect/></svg>",
    '<svg><text title="a < b">x</text></svg>',
  ])("lets a plain drawing through: %s", (svg) => {
    expect(svgHasActiveContent(text(svg))).toBe(false);
  });

  it.each([
    "<svg><script>alert(1)</script></svg>",
    '<svg><script xlink:href="https://evil.test/x.js"/></svg>',
    '<svg onload="alert(1)"></svg>',
    '<svg>\n<rect\nonclick="alert(1)"/></svg>',
    '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
    '<svg><a href="java\nscript:alert(1)">x</a></svg>',
    '<svg><a href="&#106;avascript:alert(1)">x</a></svg>',
    '<svg><a href="&#x6A;avascript&#x3A;alert(1)">x</a></svg>',
    '<svg><set attributeName="onmouseover" to="alert(1)"/></svg>',
    '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>',
    '<svg><iframe src="https://evil.test"></iframe></svg>',
    '<svg><foreignObject><embed src="x"/></foreignObject></svg>',
    '<svg><a href="data:text/html,<script>alert(1)</script>">x</a></svg>',
    '<svg xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script></svg>',
    '<svg><foreignObject><h:iframe xmlns:h="http://www.w3.org/1999/xhtml" srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"/></foreignObject></svg>',
    '<svg><foreignObject><h:meta xmlns:h="http://www.w3.org/1999/xhtml" http-equiv="refresh" content="0;url=https://evil.test"/></foreignObject></svg>',
    '<?xml-stylesheet type="text/xsl" href="https://evil.test/x.xsl"?><svg/>',
    '<svg><a href="j&#x0A;avascript:alert(1)">x</a></svg>',
    '<svg onload="alert(1)"',
    '<!DOCTYPE svg [<!ENTITY js "javascript:alert(1)">]><svg><a href="&js;">x</a></svg>',
    '<!DOCTYPE svg [<!ENTITY a "java"><!ENTITY b "script:alert(1)">]><svg><a href="&a;&b;">x</a></svg>',
    '<!DOCTYPE svg [<!ATTLIST svg onload CDATA "alert(1)">]><svg/>',
    '<!DOCTYPE svg [<!ENTITY % p SYSTEM "https://evil.test/p.dtd"> %p;]><svg/>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
    '<!DOCTYPE svg [<!ENTITY a "&b;&b;&b;">]><svg/>',
    '<!DOCTYPE svg [<!ENTITY a "<script>alert(1)</script>">]><svg>&a;</svg>',
  ])("refuses %s", (svg) => {
    expect(svgHasActiveContent(text(svg))).toBe(true);
  });
});

describe("xmlRootName", () => {
  it.each([
    ["<svg/>", "svg"],
    ['<?xml version="1.0"?><?xml-stylesheet href="a.css"?>\n<svg width="1">', "svg"],
    ['<!-- a --><!-- b -->\n<mxfile host="x">', "mxfile"],
    ['<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg>', "svg"],
    ['   <svg:svg xmlns:svg="x">', "svg:svg"],
    ['<!DOCTYPE svg [<!ENTITY x "y">]><svg>', "svg"],
  ])("finds the root of %j", (text, root) => {
    expect(xmlRootName(text)).toBe(root);
  });

  it.each([
    "",
    "texte",
    "<!-- jamais fermé <svg>",
    "<?xml version",
    '<!DOCTYPE svg [<!ENTITY x "y"><svg>',
    "<1svg>",
  ])("gives null for %j", (text) => {
    expect(xmlRootName(text)).toBeNull();
  });

  // A regular expression with a repeated comment group took minutes on
  // a few hundred bytes of comments.
  it("stays fast on files made of comments", () => {
    const start = performance.now();
    expect(xmlRootName(`${"<!---->".repeat(100_000)}x`)).toBeNull();
    expect(matchesSignature("svg", text(`${"<!---->".repeat(500)}x`))).toBe(false);
    expect(matchesSignature("drawio", text(`${"<!--".repeat(1000)}`))).toBe(false);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("svgHasActiveContent on hostile files", () => {
  // Linear work on 1 MB takes milliseconds. Quadratic work would take hours,
  // so the generous limit only fails on a real regression, even on a busy runner.
  it("stays linear on half-open tags, comments and entities", () => {
    const inputs = [
      "<".repeat(1_000_000),
      `<svg a="${"<".repeat(1_000_000)}`,
      "<!--".repeat(250_000),
      `<!DOCTYPE svg [${"<!ENTITY a ".repeat(100_000)}`,
      `<svg ${"a ".repeat(500_000)}`,
    ];
    for (const input of inputs) {
      const start = performance.now();
      svgHasActiveContent(text(input));
      expect(performance.now() - start).toBeLessThan(5000);
    }
  });
});
