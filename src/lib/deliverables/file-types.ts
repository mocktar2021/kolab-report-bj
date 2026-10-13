// Files experts can upload, by extension. Used by the upload form and by the
// API routes. The bucket allow-list in
// supabase/migrations/20261013190000_deliverable_uploads.sql lists the same
// MIME types.

/** Bucket file_size_limit and the deliverables.size_bytes check. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** SVG files are read whole to look for scripts, so they stay small. */
export const MAX_SVG_BYTES = 5 * 1024 * 1024;

/** What the stored bytes must look like, checked after the upload. */
export type FileSignature = "zip" | "ole" | "pdf" | "png" | "jpeg" | "webp" | "svg" | "drawio" | "text";

export type FileKind = "document" | "spreadsheet" | "presentation" | "pdf" | "text" | "image" | "diagram";

type FileTypeSpec = { mime: string; signature: FileSignature; kind: FileKind };

const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const EXCEL = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const POWERPOINT = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const FILE_TYPES = {
  docx: { mime: WORD, signature: "zip", kind: "document" },
  doc: { mime: "application/msword", signature: "ole", kind: "document" },
  xlsx: { mime: EXCEL, signature: "zip", kind: "spreadsheet" },
  xls: { mime: "application/vnd.ms-excel", signature: "ole", kind: "spreadsheet" },
  csv: { mime: "text/csv", signature: "text", kind: "spreadsheet" },
  pptx: { mime: POWERPOINT, signature: "zip", kind: "presentation" },
  pdf: { mime: "application/pdf", signature: "pdf", kind: "pdf" },
  txt: { mime: "text/plain", signature: "text", kind: "text" },
  md: { mime: "text/markdown", signature: "text", kind: "text" },
  png: { mime: "image/png", signature: "png", kind: "image" },
  jpg: { mime: "image/jpeg", signature: "jpeg", kind: "image" },
  jpeg: { mime: "image/jpeg", signature: "jpeg", kind: "image" },
  webp: { mime: "image/webp", signature: "webp", kind: "image" },
  svg: { mime: "image/svg+xml", signature: "svg", kind: "image" },
  drawio: { mime: "application/vnd.jgraph.mxfile", signature: "drawio", kind: "diagram" },
  vsdx: { mime: "application/vnd.ms-visio.drawing.main+xml", signature: "zip", kind: "diagram" },
} as const satisfies Record<string, FileTypeSpec>;

export type FileExtension = keyof typeof FILE_TYPES;

export type FileType = FileTypeSpec & { extension: FileExtension; maxBytes: number };

/** Value for the `accept` attribute of the file input. */
export const ACCEPTED_EXTENSIONS = Object.keys(FILE_TYPES)
  .map((extension) => `.${extension}`)
  .join(",");

/** Lower-case extension after the last dot, or "" when there is none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

export function fileTypeFor(name: string): FileType | null {
  const extension = fileExtension(name);
  if (!Object.hasOwn(FILE_TYPES, extension)) return null;
  const spec: FileTypeSpec = FILE_TYPES[extension as FileExtension];
  return {
    ...spec,
    extension: extension as FileExtension,
    maxBytes: spec.signature === "svg" ? MAX_SVG_BYTES : MAX_UPLOAD_BYTES,
  };
}

export type FileRejection = "fileType" | "fileEmpty" | "fileTooLarge" | "svgTooLarge";

/** The checks both the form and the API run before an upload starts. */
export function checkFileBeforeUpload(name: string, size: number): FileRejection | null {
  const type = fileTypeFor(name);
  if (!type) return "fileType";
  if (size <= 0) return "fileEmpty";
  if (size > type.maxBytes) return type.signature === "svg" ? "svgTooLarge" : "fileTooLarge";
  return null;
}

/**
 * File name for the storage path. Storage keys only take a small set of ASCII
 * characters, so accents are dropped and anything else becomes a dash. The
 * original name stays in deliverables.file_name.
 */
export function storageFileName(name: string): string {
  const extension = fileExtension(name);
  const base = extension ? name.slice(0, -(extension.length + 1)) : name;
  const safe = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${safe || "fichier"}${extension ? `.${extension}` : ""}`;
}
