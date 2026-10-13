"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Archive, FilePlus2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Link, useRouter } from "@/i18n/navigation";
import type { PromptStatus } from "@/lib/prompts/catalog";
import { setPromptStatus, type PromptActionError } from "../actions";

type VersionActionsProps = {
  workspaceId: string;
  versionId: string;
  status: PromptStatus;
  newVersionHref: string;
};

/** Manager actions on a version of a workspace template. */
export function VersionActions({ workspaceId, versionId, status, newVersionHref }: VersionActionsProps) {
  const t = useTranslations("Prompts");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<PromptActionError | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function changeStatus(next: "published" | "archived") {
    setConfirmOpen(false);
    setError(null);
    startTransition(async () => {
      try {
        const result = await setPromptStatus(workspaceId, versionId, next);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch {
        setError("generic");
      }
    });
  }

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild shape="pill">
          <Link href={newVersionHref}>
            <FilePlus2 aria-hidden="true" />
            {t("actions.newVersion")}
          </Link>
        </Button>
        {status === "published" ? null : (
          <Button
            type="button"
            variant="outline"
            shape="pill"
            disabled={pending}
            onClick={() => changeStatus("published")}
          >
            <Send aria-hidden="true" />
            {t("actions.publish")}
          </Button>
        )}
        {status === "archived" ? null : (
          <Button
            type="button"
            variant="ghost"
            shape="pill"
            disabled={pending}
            // Archiving the published version leaves the template unused, so it asks first.
            onClick={() => (status === "published" ? setConfirmOpen(true) : changeStatus("archived"))}
          >
            <Archive aria-hidden="true" />
            {t("actions.archive")}
          </Button>
        )}
      </div>
      <div role="status" aria-live="polite" className="mt-2 text-sm">
        {error ? <p className="text-destructive">{t(`actionErrors.${error}`)}</p> : null}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="p-6">
          <DialogTitle>{t("archiveTitle")}</DialogTitle>
          <DialogDescription className="mt-2">{t("archiveDescription")}</DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => changeStatus("archived")}
            >
              {t("archiveConfirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
