"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PreviewToggleProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Id of the block it shows and hides. */
  controls: string;
  /**
   * From the page's own messages: "Aperçu" and "Masquer l'aperçu", and the
   * names screen readers hear, which say what shows: "Aperçu du texte du rapport".
   */
  labels: { show: string; hide: string; showName: string; hideName: string };
};

/**
 * "Aperçu" with an arrow: shows a long text that stays hidden until asked
 * for (KRB-201), and "Masquer l'aperçu" hides it again.
 */
export function PreviewToggle({ open, onOpenChange, controls, labels }: PreviewToggleProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      shape="pill"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={open ? labels.hideName : labels.showName}
      onClick={() => onOpenChange(!open)}
    >
      {open ? labels.hide : labels.show}
      <ChevronDown
        aria-hidden="true"
        className={cn("motion-safe:transition-transform motion-safe:duration-200", open && "rotate-180")}
      />
    </Button>
  );
}
