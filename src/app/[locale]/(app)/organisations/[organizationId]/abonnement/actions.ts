"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { OFFER_CODES } from "@/lib/billing/catalog";
import { startPurchase, type CheckoutError } from "@/lib/billing/checkout";
import { checkoutDeps } from "@/lib/billing/server";
import { getBillingSettings } from "@/lib/billing/settings";
import { getCurrentProfile } from "@/lib/supabase/user";
import { uuidSchema } from "@/lib/workspaces/schemas";

export type CheckoutState = { status: "idle" } | { status: "error"; error: CheckoutError };

const checkoutSchema = z.object({
  organizationId: uuidSchema,
  offer: z.enum(OFFER_CODES),
  quantity: z.coerce.number().int().min(1).max(10),
  workspaceId: uuidSchema.nullable(),
});

/**
 * Starts the payment of an offer (ADR 001, 8.2) and sends the buyer to
 * FedaPay's payment page. The form sends the offer, a pack quantity and the
 * workspace of a pass, never an amount. The database checks that the buyer
 * may pay for the organization. Also used by "Réessayer" on the return
 * page: the same order, still pending, is paid again on its transaction.
 */
export async function startCheckout(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const parsed = checkoutSchema.safeParse({
    organizationId: formData.get("organizationId"),
    offer: formData.get("offer"),
    quantity: formData.get("quantity") ?? 1,
    workspaceId: formData.get("workspaceId") || null,
  });
  if (!parsed.success) return { status: "error", error: "invalidOffer" };

  const settings = getBillingSettings();
  if (!settings.api) return { status: "error", error: "unavailable" };
  const profile = await getCurrentProfile();
  if (!profile) return { status: "error", error: "forbidden" };

  const result = await startPurchase(checkoutDeps(settings, settings.api), {
    organizationId: parsed.data.organizationId.toLowerCase(),
    offer: parsed.data.offer,
    quantity: parsed.data.quantity,
    workspaceId: parsed.data.workspaceId?.toLowerCase() ?? null,
    buyer: { id: profile.id, email: profile.email, name: profile.name },
  });
  if (!result.ok) return { status: "error", error: result.error };
  // FedaPay's payment page, or the return page when the order was paid already.
  redirect(result.url);
}
