"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import type { WorkspaceRole } from "@/lib/workspaces/roles";
import { removeMember, updateMemberRole, type MemberActionState } from "./actions";

export type MemberRowData = {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  isSelf: boolean;
  editable: boolean;
};

type MemberListProps = {
  workspaceId: string;
  members: MemberRowData[];
  grantable: WorkspaceRole[];
};

export function MemberList({ workspaceId, members, grantable }: MemberListProps) {
  const t = useTranslations("Members");

  return (
    <section
      aria-labelledby="members-title"
      className="surface-card mt-8 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 id="members-title" className="font-medium">
          {t("listTitle")}
        </h2>
        <span className="text-sm text-muted-foreground">{t("count", { count: members.length })}</span>
      </div>
      <ul className="divide-y">
        {members.map((member) => (
          <MemberRow key={member.userId} workspaceId={workspaceId} member={member} grantable={grantable} />
        ))}
      </ul>
    </section>
  );
}

function MemberRow({
  workspaceId,
  member,
  grantable,
}: {
  workspaceId: string;
  member: MemberRowData;
  grantable: WorkspaceRole[];
}) {
  const t = useTranslations("Members");
  const tWorkspaces = useTranslations("Workspaces");
  const [role, setRole] = useState<WorkspaceRole>(member.role);
  const [roleState, roleAction, rolePending] = useActionState<MemberActionState, FormData>(updateMemberRole, {
    status: "idle",
  });
  const [removeState, removeAction, removePending] = useActionState<MemberActionState, FormData>(
    removeMember,
    { status: "idle" },
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  // A rejected change (last owner, for example) puts the select back.
  useEffect(() => {
    if (roleState.status === "error") setRole(member.role);
  }, [roleState, member.role]);

  // The current role stays in the list even when the caller cannot grant it
  // (an admin looking at their own row, for example).
  const roleOptions = grantable.includes(member.role) ? grantable : [member.role, ...grantable];
  const error =
    (removeState.status === "error" && removeState.error) ||
    (roleState.status === "error" && roleState.error);
  const selectId = `role-${member.userId}`;
  const statusId = `member-status-${member.userId}`;

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <UserAvatar name={member.name} />
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-sm font-medium">
            <span className="truncate">{member.name}</span>
            {member.isSelf ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {t("you")}
              </span>
            ) : null}
          </p>
          {member.name !== member.email ? (
            <p className="truncate text-xs text-muted-foreground">{member.email}</p>
          ) : null}
          <p id={statusId} role="status" aria-live="polite" className="text-xs">
            {error ? (
              <span className="text-destructive">{tWorkspaces(`errors.${error}`)}</span>
            ) : roleState.status === "success" && role === member.role ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Check className="size-3.5" aria-hidden="true" />
                {t("roleSaved")}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {member.editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <form action={roleAction} className="flex items-center gap-2">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="userId" value={member.userId} />
            <label htmlFor={selectId} className="sr-only">
              {t("roleLabel", { name: member.name })}
            </label>
            <NativeSelect
              id={selectId}
              name="role"
              value={role}
              onChange={(event) => setRole(event.target.value as WorkspaceRole)}
              className="w-40"
              aria-describedby={statusId}
            >
              {roleOptions.map((option) => (
                <option key={option} value={option}>
                  {tWorkspaces(`roles.${option}`)}
                </option>
              ))}
            </NativeSelect>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={rolePending || role === member.role}
              aria-label={t("saveRoleLabel", { name: member.name })}
            >
              {t("saveRole")}
            </Button>
          </form>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmOpen(true)}
            aria-label={member.isSelf ? t("leave") : t("removeLabel", { name: member.name })}
          >
            {member.isSelf ? t("leave") : t("remove")}
          </Button>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent className="p-6">
              <DialogTitle>
                {member.isSelf ? t("leaveTitle") : t("removeTitle", { name: member.name })}
              </DialogTitle>
              <DialogDescription className="mt-2">
                {member.isSelf ? t("leaveDescription") : t("removeDescription", { name: member.name })}
              </DialogDescription>
              <form
                action={(formData) => {
                  setConfirmOpen(false);
                  removeAction(formData);
                }}
                className="mt-6 flex justify-end gap-2"
              >
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <input type="hidden" name="userId" value={member.userId} />
                <DialogClose asChild>
                  <Button type="button" variant="ghost">
                    {t("cancel")}
                  </Button>
                </DialogClose>
                <Button type="submit" variant="destructive" disabled={removePending}>
                  {member.isSelf ? t("leaveConfirm") : t("removeConfirm")}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">{tWorkspaces(`roles.${member.role}`)}</span>
      )}
    </li>
  );
}
