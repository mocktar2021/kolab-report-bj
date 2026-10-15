"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Link } from "@/i18n/navigation";
import { organizationSettingsPath } from "@/lib/account/blockers";
import type { OwnedOrganization } from "@/lib/account/server";
import { transferOrganization, type TransferState } from "./actions";

/**
 * Hands one organization to an owner of one of its workspaces, after a
 * confirmation. With nobody to take it over, says how to get there.
 */
export function TransferForm({ organization }: { organization: OwnedOrganization }) {
  const t = useTranslations("Account.transfer");
  const [state, formAction, pending] = useActionState<TransferState, FormData>(transferOrganization, {
    status: "idle",
  });
  const [selected, setSelected] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const chosen = organization.candidates.find((candidate) => candidate.userId === selected);
  const selectId = `transfer-${organization.id}`;
  const statusId = `transfer-status-${organization.id}`;

  if (organization.candidates.length === 0) {
    return (
      <div>
        <p className="text-sm font-medium">{organization.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("noCandidate", { organization: organization.name })}
        </p>
        <Link
          href={organizationSettingsPath(organization.id)}
          className="mt-1.5 inline-block rounded text-sm font-medium underline underline-offset-4 hover:text-highlight"
        >
          {t("deleteOrganization")}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (chosen) setConfirmOpen(true);
        }}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor={selectId}>{t("newOwner", { organization: organization.name })}</Label>
          <NativeSelect
            id={selectId}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            selectClassName="h-10"
            aria-describedby={statusId}
          >
            <option value="">{t("choose")}</option>
            {organization.candidates.map((candidate) => (
              <option key={candidate.userId} value={candidate.userId}>
                {candidate.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          type="submit"
          variant="outline"
          shape="pill"
          className="h-10 shrink-0"
          disabled={!chosen || pending}
        >
          {t("submit")}
        </Button>
      </form>
      <p id={statusId} role="status" aria-live="polite" className="mt-2 text-sm text-destructive">
        {state.status === "error" ? t(`errors.${state.error}`) : null}
      </p>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="p-6">
          <DialogTitle>{t("confirmTitle", { organization: organization.name })}</DialogTitle>
          <DialogDescription className="mt-2">
            {t("confirmDescription", { name: chosen?.name ?? "" })}
          </DialogDescription>
          <form
            action={(formData) => {
              setConfirmOpen(false);
              formAction(formData);
            }}
            className="mt-6 flex justify-end gap-2"
          >
            <input type="hidden" name="organizationId" value={organization.id} />
            <input type="hidden" name="newOwnerId" value={selected} />
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {t("confirm")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
