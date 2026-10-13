import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkFileBeforeUpload,
  FILE_TYPES,
  fileExtension,
  fileTypeFor,
  MAX_SVG_BYTES,
  MAX_UPLOAD_BYTES,
  storageFileName,
} from "./file-types";

describe("fileExtension", () => {
  it.each([
    ["rapport.docx", "docx"],
    ["Rapport.Final.XLSX", "xlsx"],
    ["schema.drawio", "drawio"],
    ["sans-extension", ""],
    [".bashrc", ""],
    ["fin-par-un-point.", ""],
  ])("%s gives %j", (name, extension) => {
    expect(fileExtension(name)).toBe(extension);
  });
});

describe("fileTypeFor", () => {
  it("knows the Word, Excel and diagram types", () => {
    expect(fileTypeFor("rapport.docx")).toMatchObject({ signature: "zip", kind: "document" });
    expect(fileTypeFor("budget.xlsx")?.mime).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(fileTypeFor("schema.vsdx")).toMatchObject({ signature: "zip", kind: "diagram" });
    expect(fileTypeFor("PHOTO.JPG")?.mime).toBe("image/jpeg");
  });

  it.each(["virus.exe", "page.html", "script.js", "archive.zip", "photo.heic", "toString", "a.constructor"])(
    "refuses %s",
    (name) => {
      expect(fileTypeFor(name)).toBeNull();
    },
  );

  it("caps SVG files lower than the others", () => {
    expect(fileTypeFor("logo.svg")?.maxBytes).toBe(MAX_SVG_BYTES);
    expect(fileTypeFor("rapport.pdf")?.maxBytes).toBe(MAX_UPLOAD_BYTES);
  });

  // The bucket refuses any type it does not list, so a type missing from the
  // migration would fail every upload of that kind.
  it("only uses MIME types the bucket accepts", () => {
    const migration = readFileSync("supabase/migrations/20261013190000_deliverable_uploads.sql", "utf8");
    const allowList = migration.slice(migration.indexOf("set allowed_mime_types"));
    for (const { mime } of Object.values(FILE_TYPES)) {
      expect(allowList).toContain(`'${mime}'`);
    }
  });
});

describe("checkFileBeforeUpload", () => {
  it("accepts a 50 MB Word file", () => {
    expect(checkFileBeforeUpload("rapport.docx", MAX_UPLOAD_BYTES)).toBeNull();
  });

  it.each([
    ["virus.exe", 10, "fileType"],
    ["vide.docx", 0, "fileEmpty"],
    ["gros.pdf", MAX_UPLOAD_BYTES + 1, "fileTooLarge"],
    ["logo.svg", MAX_SVG_BYTES + 1, "svgTooLarge"],
  ] as const)("refuses %s of %d bytes with %s", (name, size, rejection) => {
    expect(checkFileBeforeUpload(name, size)).toBe(rejection);
  });
});

describe("storageFileName", () => {
  it.each([
    ["Rapport d'étude n°2.docx", "Rapport-d-etude-n-2.docx"],
    ["  Schéma réseau (v3).drawio", "Schema-reseau-v3.drawio"],
    ["../../etc/passwd.txt", "etc-passwd.txt"],
    ["日本語.pdf", "fichier.pdf"],
    ["sans-extension", "sans-extension"],
  ])("%j becomes %j", (name, safe) => {
    expect(storageFileName(name)).toBe(safe);
  });

  it("only keeps characters storage accepts in a key", () => {
    expect(storageFileName('a<b>c|d?e*f"g\\h:i.png')).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("keeps long names short", () => {
    expect(storageFileName(`${"a".repeat(300)}.xlsx`)).toBe(`${"a".repeat(80)}.xlsx`);
  });
});
