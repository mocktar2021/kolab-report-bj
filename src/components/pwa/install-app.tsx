"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { installMode, promptInstall, subscribeToInstall, type InstallMode } from "@/lib/pwa/install";
import { cn } from "@/lib/utils";

const serverMode = (): InstallMode => "none";

/** What the install item does on this page, kept up to date (KRB-205). */
export function useInstallMode() {
  return useSyncExternalStore(subscribeToInstall, installMode, serverMode);
}

type InstallAppButtonProps = {
  className: string;
  /** Hide the text while the desktop sidebar is collapsed. */
  collapsible?: boolean;
};

/**
 * "Installer l'application" in the account part of the menu. Chrome, Edge and
 * Samsung Internet show their install dialog; on iPhone and iPad it opens the
 * steps of Safari's share menu. Hidden once installed, and in browsers that
 * cannot install the app.
 */
export function InstallAppButton({ className, collapsible = false }: InstallAppButtonProps) {
  const t = useTranslations("AppShell.install");
  const mode = useInstallMode();
  const [stepsOpen, setStepsOpen] = useState(false);

  if (mode === "none") return null;

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={t("button")}
        aria-haspopup={mode === "ios" ? "dialog" : undefined}
        onClick={() => (mode === "prompt" ? void promptInstall() : setStepsOpen(true))}
      >
        <Download className="size-4 shrink-0" aria-hidden="true" />
        <span className={cn(collapsible && "sidebar-collapsed:sr-only")}>{t("button")}</span>
      </button>
      {mode === "ios" ? <IosInstallSteps open={stepsOpen} onOpenChange={setStepsOpen} /> : null}
    </>
  );
}

/** The three steps of Safari's share menu, which iOS uses to install a web app. */
export function IosInstallSteps({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("AppShell.install");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-6">
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
