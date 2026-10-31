"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/workspaces/schemas";

const MAX_IDS = 100;
const idsSchema = z.array(uuidSchema).max(MAX_IDS);

/**
 * Marks notifications as read: the ones given, or all of them. RLS limits
 * the update to the user's own notifications, and read_at is the only
 * column users can change.
 */
export async function markNotificationsRead(ids?: string[]): Promise<{ ok: boolean }> {
  // Before zod: a list over the limit is refused without reading its items
  // (GHSA-mrhx-c7xc-m3w5, KRB-240).
  if (ids !== undefined && (!Array.isArray(ids) || ids.length > MAX_IDS)) return { ok: false };
  const parsed = ids === undefined ? null : idsSchema.safeParse(ids);
  if (parsed && !parsed.success) return { ok: false };

  const supabase = await createClient();
  let query = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (parsed) {
    if (parsed.data.length === 0) return { ok: true };
    query = query.in("id", parsed.data);
  }
  const { error } = await query;
  if (error) return { ok: false };

  revalidatePath("/", "layout");
  return { ok: true };
}
