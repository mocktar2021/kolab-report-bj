"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { installMode, subscribeToInstall, type InstallMode } from "@/lib/pwa/install";

const serverMode = (): InstallMode => "none";

/** What the install item does on this page, kept up to date (KRB-205). */
export function useInstallMode() {
  return useSyncExternalStore(subscribeToInstall, installMode, serverMode);
}

/** The three steps of Safari's share menu, which iOS uses to install a web app. */
export function IosInstallSteps({
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the focus goes on close: the item that opened the dialog is gone with its menu. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations("AppShell.install");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-6" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription className="mt-2">{t("description")}</DialogDescription>
        <ol className="mt-5 space-y-3 text-sm">
          <li className="flex gap-3">
            <StepNumber>1</StepNumber>
            <span>
              {t.rich("share", {
                b: (chunks) => <strong className="font-semibold">{chunks}</strong>,
                icon: () => (
                  <Share
                    className="mx-0.5 inline size-4 align-text-bottom text-highlight"
                    aria-hidden="true"
                  />
                ),
              })}
            </span>
          </li>
          <li className="flex gap-3">
            <StepNumber>2</StepNumber>
            <span>
              {t.rich("addToHome", { b: (chunks) => <strong className="font-semibold">{chunks}</strong> })}
            </span>
          </li>
          <li className="flex gap-3">
            <StepNumber>3</StepNumber>
            <span>
              {t.rich("add", { b: (chunks) => <strong className="font-semibold">{chunks}</strong> })}
            </span>
          </li>
        </ol>
        <p className="mt-5 text-small text-muted-foreground">{t("hint")}</p>
        <div className="mt-6 flex justify-end">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("close")}
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepNumber({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-highlight/10 text-xs font-semibold text-highlight"
    >
      {children}
    </span>
  );
}
