"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Check, Copy, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { WorkspaceRole } from "@/lib/workspaces/roles";
import { inviteMember, resendInvitation, revokeInvitation, type InvitationActionState } from "./actions";

export type PendingInvitationRow = {
  id: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: string;
  expired: boolean;
};

/** Invite form and pending invitations, below the member list. */
export function Invitations({
  workspaceId,
  grantable,
  pending,
}: {
  workspaceId: string;
  grantable: WorkspaceRole[];
  pending: PendingInvitationRow[];
}) {
  return (
    <>
      <InviteForm workspaceId={workspaceId} grantable={grantable} />
      <PendingInvitations pending={pending} />
    </>
  );
}

function InviteForm({ workspaceId, grantable }: { workspaceId: string; grantable: WorkspaceRole[] }) {
  const t = useTranslations("Members");
  const tWorkspaces = useTranslations("Workspaces");
  const [state, formAction, pending] = useActionState<InvitationActionState, FormData>(inviteMember, {
    status: "idle",
  });
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the address after a successful invite, keep the role.
  useEffect(() => {
    if (state.status === "sent") {
      const email = formRef.current?.elements.namedItem("email");
      if (email instanceof HTMLInputElement) email.value = "";
    }
  }, [state]);

  return (
    <section
      aria-labelledby="invite-title"
      className="surface-card mt-8 rounded-2xl border p-5 shadow-sm sm:p-6"
    >
      <h2 id="invite-title" className="font-medium">
        {t("inviteTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("inviteDescription")}</p>

      <form
        ref={formRef}
        action={formAction}
        noValidate
        className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="invite-email">{t("inviteEmail")}</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            placeholder={t("inviteEmailPlaceholder")}
            required
          />
        </div>
        <div className="space-y-2 sm:w-44">
          <Label htmlFor="invite-role">{t("inviteRole")}</Label>
          <NativeSelect id="invite-role" name="role" defaultValue="expert" selectClassName="h-10">
            {grantable.map((role) => (
              <option key={role} value={role}>
                {tWorkspaces(`roles.${role}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" shape="pill" className="h-10 shrink-0" disabled={pending}>
          <Send aria-hidden="true" />
          {t("inviteSubmit")}
        </Button>
      </form>

      <div role="status" aria-live="polite" className="mt-3 text-sm">
        <InvitationResult state={state} />
      </div>
    </section>
  );
}

/** Confirmation after an invite or a resend, with the link when the e-mail failed. */
function InvitationResult({ state }: { state: InvitationActionState }) {
  const t = useTranslations("Members");
  const tWorkspaces = useTranslations("Workspaces");

  if (state.status === "error") {
    return <p className="text-destructive">{tWorkspaces(`errors.${state.error}`)}</p>;
  }
  if (state.status !== "sent") return null;
  if (!state.link) {
    return (
      <p className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Check className="size-4" aria-hidden="true" />
        {t("inviteSent", { email: state.email })}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p>{t("inviteNotSent", { email: state.email })}</p>
      <CopyLink link={state.link} />
    </div>
  );
}

function CopyLink({ link }: { link: string }) {
  const t = useTranslations("Members");
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input readOnly value={link} aria-label={t("copyLink")} className="font-mono text-xs" />
      <Button
        type="button"
        variant="outline"
        className="h-10 shrink-0"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopied(true);
        }}
      >
        <Copy aria-hidden="true" />
        {copied ? t("linkCopied") : t("copyLink")}
      </Button>
    </div>
  );
}

function PendingInvitations({ pending }: { pending: PendingInvitationRow[] }) {
  const t = useTranslations("Members");

  return (
    <section
      aria-labelledby="pending-title"
      className="surface-card mt-4 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 id="pending-title" className="font-medium">
          {t("pendingTitle")}
        </h2>
        <span className="text-sm text-muted-foreground">{pending.length}</span>
      </div>
      {pending.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">{t("pendingEmpty")}</p>
      ) : (
        <ul className="divide-y">
          {pending.map((invitation) => (
            <PendingRow key={invitation.id} invitation={invitation} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PendingRow({ invitation }: { invitation: PendingInvitationRow }) {
  const t = useTranslations("Members");
  const tWorkspaces = useTranslations("Workspaces");
  const format = useFormatter();
  const [resendState, resendAction, resendPending] = useActionState<InvitationActionState, FormData>(
    resendInvitation,
    { status: "idle" },
  );
  const [revokeState, revokeAction, revokePending] = useActionState<InvitationActionState, FormData>(
    revokeInvitation,
    { status: "idle" },
  );
  const state = revokeState.status === "error" ? revokeState : resendState;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{invitation.email}</p>
          <p className="text-xs text-muted-foreground">
            {tWorkspaces(`roles.${invitation.role}`)}
            {" · "}
            {invitation.expired ? (
              <span className="text-destructive">{t("pendingExpired")}</span>
            ) : (
              t("pendingExpires", {
                date: format.dateTime(new Date(invitation.expiresAt), { day: "numeric", month: "long" }),
              })
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <form action={resendAction}>
            <input type="hidden" name="invitationId" value={invitation.id} />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={resendPending}
              aria-label={t("resendLabel", { email: invitation.email })}
            >
              {t("resend")}
            </Button>
          </form>
          <form action={revokeAction}>
            <input type="hidden" name="invitationId" value={invitation.id} />
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={revokePending}
              aria-label={t("revokeLabel", { email: invitation.email })}
            >
              {t("revoke")}
            </Button>
          </form>
        </div>
      </div>
      <div role="status" aria-live="polite" className="mt-2 text-sm empty:mt-0">
        <InvitationResult state={state} />
      </div>
    </li>
  );
}
