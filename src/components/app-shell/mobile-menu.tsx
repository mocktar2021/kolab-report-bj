"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Menu } from "lucide-react";
import type { MenuSheetProps } from "./menu-sheet";
import { usePalette } from "./palette";

// The sheet and what it repeats of the sidebar load when the button is
// pointed at, focused or tapped, not with the page (KRB-212).
const loadMenuSheet = () => import("./menu-sheet").then((mod) => mod.MenuSheet);
const MenuSheet = dynamic(loadMenuSheet, { ssr: false });

/** The menu button of the top bar below lg, and its sheet. */
export function MobileMenu({ className, ...sheet }: MenuSheetProps & { className: string }) {
  const t = useTranslations("AppShell");
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // The palette opens over a closed menu, as it did when one component held both.
  const paletteOpen = palette?.isOpen ?? false;
  const [seenPaletteOpen, setSeenPaletteOpen] = useState(paletteOpen);
  if (paletteOpen !== seenPaletteOpen) {
    setSeenPaletteOpen(paletteOpen);
    if (paletteOpen) setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onPointerEnter={() => void loadMenuSheet()}
        onFocus={() => void loadMenuSheet()}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
        aria-label={t("openMenu")}
        aria-expanded={open}
        className={className}
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>
      {mounted ? <MenuSheet open={open} onOpenChange={setOpen} {...sheet} /> : null}
    </>
  );
}
