import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { fileTypeFor } from "./file-types";
import { PARSE_LIMITS, ParseError } from "./parse/types";
import { DELIVERABLES_BUCKET } from "./server";

// Reading a deliverable runs with the service role, after the request that
// asked for it has answered (next/server after()). Users never write the
// parse columns.

/** A claim this old is taken for a parse that died, and can be retried. */
export const STALE_PARSE_MS = 5 * 60 * 1000;

export type ParseClaim = { id: string; workspace_id: string; storage_path: string; file_name: string };

/**
 * Marks a checked file as being read, unless a read is already running.
 * Pending and failed files can be claimed, and running ones once stale.
 */
export async function claimParse(id: string, workspaceId: string): Promise<ParseClaim | null> {
  const staleBefore = new Date(Date.now() - STALE_PARSE_MS).toISOString();
  const { data, error } = await createAdminClient()
    .from("deliverables")
    .update({ parse_status: "processing", parse_error: null })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .not("uploaded_at", "is", null)
    .or(`parse_status.in.(pending,failed),and(parse_status.eq.processing,updated_at.lt.${staleBefore})`)
    .select("id, workspace_id, storage_path, file_name")
    .maybeSingle();
  if (error) console.error("deliverables: could not claim a parse", error.message);
  return data;
}

function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Reads a claimed file and stores the Markdown, or why it failed. Never throws. */
export async function runParse(claim: ParseClaim): Promise<void> {
  const admin = createAdminClient();
  const save = async (values: {
    parse_status: "parsed" | "skipped" | "failed";
    parsed_content: string | null;
    parse_meta: Json | null;
    parse_error: string | null;
  }) => {
    const { error } = await admin
      .from("deliverables")
      .update({ ...values, parsed_at: values.parse_status === "failed" ? null : new Date().toISOString() })
      .eq("id", claim.id)
      .eq("workspace_id", claim.workspace_id)
      .eq("parse_status", "processing");
    if (error) console.error("deliverables: could not save a parse", error.message);
  };

  try {
    // Loaded here so the routes that only claim stay light.
    const { isParsed, parseDeliverableFile } = await import("./parse");
    const type = fileTypeFor(claim.file_name);
    if (!type) throw new ParseError("unreadable");
    let bytes = Buffer.alloc(0);
    if (isParsed(type.extension)) {
      const { data, error } = await admin.storage.from(DELIVERABLES_BUCKET).download(claim.storage_path);
      if (error || !data) throw new ParseError("unreadable");
      bytes = Buffer.from(await data.arrayBuffer());
    }
    const result = await withTimeout(
      parseDeliverableFile(type.extension, bytes),
      PARSE_LIMITS.timeoutMs,
      () => new ParseError("timeout"),
    );
    await save({
      parse_status: result.status,
      parsed_content: result.status === "parsed" ? result.markdown : null,
      parse_meta: result.meta as Json,
      parse_error: null,
    });
  } catch (error) {
    if (!(error instanceof ParseError)) console.error("deliverables: parse failed", error);
    await save({
      parse_status: "failed",
      parsed_content: null,
      parse_meta: null,
      parse_error: error instanceof ParseError ? error.key : "unreadable",
    });
  }
}
