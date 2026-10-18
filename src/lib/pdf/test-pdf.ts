// Test helper: small PDFs built byte by byte, for the PDF readers (KRB-214)
// and the end-to-end tests. Node only. Text is drawn in Helvetica, encoded
// in WinAnsi, so it takes Latin-1 and the curly apostrophe.
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createDeflate, deflateSync } from "node:zlib";

export type TestPdfOptions = {
  /** Draws a small gray image on every page, like a scan. */
  image?: boolean;
  /** Protects the file with this user password: the standard handler, RC4 40 bits (revision 2). */
  password?: string;
  /** Compresses the content streams. */
  deflate?: boolean;
  /** A content stream already compressed with zlib, drawn on every page after the lines. */
  deflated?: Uint8Array;
};

/** Padding of the standard security handler. */
const PAD = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
const FILE_ID = Buffer.from("4b524232313474657374706466696478", "hex");
/** Every permission. */
const PERMISSIONS = -4;

function rc4(key: Uint8Array, data: Uint8Array): Buffer {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i]! + key[i % key.length]!) % 256;
    [state[i], state[j]] = [state[j]!, state[i]!];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let index = 0; index < data.length; index++) {
    i = (i + 1) % 256;
    j = (j + state[i]!) % 256;
    [state[i], state[j]] = [state[j]!, state[i]!];
    out[index] = data[index]! ^ state[(state[i]! + state[j]!) % 256]!;
  }
  return out;
}

const md5 = (...parts: Uint8Array[]) => {
  const hash = createHash("md5");
  for (const part of parts) hash.update(part);
  return hash.digest();
};

function padded(password: string): Buffer {
  return Buffer.concat([Buffer.from(password, "latin1"), PAD]).subarray(0, 32);
}

/** The /O and /U entries and the file key, owner password same as the user's (PDF 1.7, algorithms 2 to 4). */
function securityKeys(password: string) {
  const owner = rc4(md5(padded(password)).subarray(0, 5), padded(password));
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(PERMISSIONS);
  const key = md5(padded(password), owner, permissions, FILE_ID).subarray(0, 5);
  return { owner, user: rc4(key, PAD), key };
}

/** The key of one object (PDF 1.7, algorithm 1). */
function objectKey(fileKey: Buffer, number: number): Buffer {
  const id = Buffer.from([number & 0xff, (number >> 8) & 0xff, (number >> 16) & 0xff, 0, 0]);
  return md5(fileKey, id).subarray(0, 10);
}

const WIN_ANSI: Record<string, number> = { "’": 0x92, "€": 0x80, œ: 0x9c, "…": 0x85, "–": 0x96 };

function pdfString(value: string): Buffer {
  const bytes = Array.from(value, (char) => {
    const code = WIN_ANSI[char] ?? char.charCodeAt(0);
    if (code > 0xff) throw new Error(`not in WinAnsi: ${char}`);
    return code;
  });
  const escaped = Buffer.from(bytes)
    .toString("latin1")
    .replace(/[\\()]/g, (char) => `\\${char}`);
  return Buffer.from(`(${escaped})`, "latin1");
}

/**
 * A PDF with one page per entry of `pages`, each line drawn in Helvetica.
 * A page with no line has no text.
 */
export function testPdf(pages: string[][], options: TestPdfOptions = {}): Uint8Array {
  const objects: (Buffer | ((number: number) => Buffer))[] = [];
  const add = (body: Buffer | ((number: number) => Buffer)) => objects.push(body);
  const security = options.password === undefined ? null : securityKeys(options.password);

  const stream =
    (dictionary: string, data: Buffer, deflated = false) =>
    (number: number) => {
      let body = options.deflate && !deflated ? deflateSync(data) : data;
      const filter = options.deflate || deflated ? " /Filter /FlateDecode" : "";
      if (security) body = rc4(objectKey(security.key, number), body);
      return Buffer.concat([
        Buffer.from(`<< ${dictionary}${filter} /Length ${body.length} >>\nstream\n`, "latin1"),
        body,
        Buffer.from("\nendstream", "latin1"),
      ]);
    };

  const catalog = add(Buffer.alloc(0));
  const pagesId = add(Buffer.alloc(0));
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const font = add(
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
  );
  const image = options.image
    ? add(
        stream(
          "/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8",
          Buffer.from([0x20, 0x80, 0x80, 0xe0]),
        ),
      )
    : null;
  const kids: number[] = [];
  for (const lines of pages) {
    const drawn = [
      image ? Buffer.from("q 400 0 0 500 100 200 cm /Im1 Do Q\n") : Buffer.alloc(0),
      lines.length > 0
        ? Buffer.concat([
            Buffer.from("BT /F1 11 Tf 14 TL 56 790 Td "),
            ...lines.map((line) => Buffer.concat([pdfString(line), Buffer.from(" Tj T* ")])),
            Buffer.from("ET"),
          ])
        : Buffer.alloc(0),
    ];
    const contents = [add(stream("", Buffer.concat(drawn)))];
    if (options.deflated) contents.push(add(stream("", Buffer.from(options.deflated), true)));
    const xobject = image ? ` /XObject << /Im1 ${image} 0 R >>` : "";
    kids.push(
      add(
        Buffer.from(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >>${xobject} >> /Contents [${contents.map((id) => `${id} 0 R`).join(" ")}] >>`,
        ),
      ),
    );
  }
  objects[pagesId - 1] = Buffer.from(
    `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(" ")}] /Count ${kids.length} >>`,
  );
  const encrypt = security
    ? add(
        Buffer.from(
          `<< /Filter /Standard /V 1 /R 2 /Length 40 /P ${PERMISSIONS} /O <${security.owner.toString("hex")}> /U <${security.user.toString("hex")}> >>`,
        ),
      )
    : null;

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let size = chunks[0]!.length;
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    const number = index + 1;
    const object = Buffer.concat([
      Buffer.from(`${number} 0 obj\n`),
      typeof body === "function" ? body(number) : body,
      Buffer.from("\nendobj\n"),
    ]);
    offsets.push(size);
    chunks.push(object);
    size += object.length;
  });
  const xref = [
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
  ].join("");
  const id = FILE_ID.toString("hex");
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${encrypt ? ` /Encrypt ${encrypt} 0 R` : ""} /ID [<${id}> <${id}>] >>\nstartxref\n${size}\n%%EOF\n`;
  chunks.push(Buffer.from(xref + trailer, "latin1"));
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * `mb` megabytes of spaces compressed with zlib, a megabyte at a time: a
 * content stream of a few MB that decodes to a lot, for `deflated`.
 */
export async function deflatedSpaces(mb: number): Promise<Uint8Array> {
  const deflate = createDeflate({ level: 1 });
  const chunks: Buffer[] = [];
  deflate.on("data", (chunk: Buffer) => chunks.push(chunk));
  const block = Buffer.alloc(1024 * 1024, 0x20);
  for (let index = 0; index < mb; index++) if (!deflate.write(block)) await once(deflate, "drain");
  deflate.end();
  await once(deflate, "end");
  return new Uint8Array(Buffer.concat(chunks));
}
