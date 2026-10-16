import { decodeText } from "../deliverables/parse/text";
import { ParseError } from "../deliverables/parse/types";
import { linesFromDocx } from "./docx";
import { extractPlan } from "./extract";
import { linesFromText } from "./lines";
import { readPdfText } from "./pdf";
import {
  PLAN_LIMITS,
  PlanReadError,
  type ExtractedPlan,
  type PlanFormat,
  type PlanReadErrorKey,
} from "./types";

// What the plan worker does with a file (./worker.ts). Word, text and
// Markdown give a plan, read without AI; a PDF gives its text, which the
// route sends to the AI. Pasted text comes as a .txt file.

export type PlanFileResult =
  | { kind: "plan"; plan: ExtractedPlan | null }
  | { kind: "pdf"; text: string; pages: number; truncated: boolean };

/** Bytes of a text file that hold at least maxTextChars characters, whatever the encoding. */
const TEXT_BYTES = PLAN_LIMITS.maxTextChars * 3;

/** The start of a text file, UTF-8 or Windows-1252, as the deliverables read it. */
export function decodePlanText(bytes: Uint8Array): string {
  const cut = bytes.length > TEXT_BYTES;
  return decodeText(bytes.subarray(0, TEXT_BYTES), cut).slice(0, PLAN_LIMITS.maxTextChars);
}

export async function readPlanFile(format: PlanFormat, bytes: Uint8Array): Promise<PlanFileResult> {
  switch (format) {
    case "docx":
      return {
        kind: "plan",
        plan: extractPlan(await linesFromDocx(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))),
      };
    case "txt":
    case "md":
      return { kind: "plan", plan: extractPlan(linesFromText(decodePlanText(bytes))) };
    case "pdf":
      return { kind: "pdf", ...(await readPdfText(bytes)) };
  }
}

/** Why a file could not be read, from whatever the readers threw. */
export function readErrorKey(error: unknown): PlanReadErrorKey {
  if (error instanceof PlanReadError) return error.key;
  // The archive checks of the deliverables (guardZip).
  if (error instanceof ParseError) return error.key === "tooLarge" ? "tooLarge" : "unreadable";
  return "unreadable";
}
