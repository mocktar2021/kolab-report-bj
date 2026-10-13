"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { acceptInvitation, type AcceptState } from "./actions";

/** Joins the workspace, or opens it when the user already joined with this link. */
export function AcceptForm({ token, label }: { token: string; label: "accept" | "open" }) {
  const t = useTranslations("Invitation");
  const tWorkspaces = useTranslations("Workspaces");
  const [state, formAction, pending] = useActionState<AcceptState, FormData>(acceptInvitation, {});

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" shape="pill" className="h-10 w-full" disabled={pending}>
        {t(label)}
      </Button>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {tWorkspaces(`errors.${state.error}`)}
        </p>
      ) : null}
    </form>
  );
}
