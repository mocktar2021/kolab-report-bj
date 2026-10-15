"use client";

import { useActionState, useId } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OfferCode } from "@/lib/billing/catalog";
import { cn } from "@/lib/utils";
import { startCheckout, type CheckoutState } from "./actions";

/**
 * One "Payer" button: posts the offer code (never an amount) to startCheckout,
 * which sends the browser to FedaPay's payment page. Fields such as the pack
 * quantity or the pass's workspace come as children, or as fixed values.
 */
export function CheckoutForm({
  organizationId,
  offer,
  label,
  accessibleLabel,
  quantity,
  workspaceId,
  variant = "default",
  className,
  children,
}: {
  organizationId: string;
  offer: OfferCode;
  /** Visible text of the button. */
  label: string;
  /** Names the offer and its price, so each button is unique for screen readers. */
  accessibleLabel?: string;
  quantity?: number;
  workspaceId?: string | null;
  variant?: "default" | "outline";
  className?: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations("Billing.checkout");
  const tOffers = useTranslations("Billing.offers");
  const errorId = useId();
  const [state, formAction, pending] = useActionState<CheckoutState, FormData>(startCheckout, {
    status: "idle",
  });
  const error = state.status === "error" ? t(`errors.${state.error}`) : null;

  return (
    <form
      action={formAction}
      className={cn("space-y-3", className)}
      onSubmit={(event) => {
        // The button stays focusable while the payment starts (aria-disabled).
        if (pending) event.preventDefault();
      }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="offer" value={offer} />
      {quantity !== undefined ? <input type="hidden" name="quantity" value={quantity} /> : null}
      {workspaceId ? <input type="hidden" name="workspaceId" value={workspaceId} /> : null}
      {children}
      <Button
        type="submit"
        variant={variant}
        shape="pill"
        className="w-full"
        aria-label={accessibleLabel}
        aria-disabled={pending || undefined}
        aria-describedby={error ? errorId : undefined}
      >
        {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
        {pending ? tOffers("pending") : label}
      </Button>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
