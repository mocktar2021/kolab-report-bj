"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { MyWorkspace } from "@/lib/workspaces/types";
import type { PaletteScope } from "./command-palette";

// The palette and cmdk load the first time it opens, not with every page
// (KRB-154).
const CommandPalette = dynamic(() => import("./command-palette").then((mod) => mod.CommandPalette), {
  ssr: false,
});

type PaletteContextValue = {
  /** Opens the palette on every action, or on the workspace search (KRB-206). */
  open: (scope: PaletteScope) => void;
  isOpen: boolean;
};

const PaletteContext = createContext<PaletteContextValue | null>(null);

/** The palette of the app shell, or null outside it (unit tests of a single island). */
export function usePalette() {
  return useContext(PaletteContext);
}

type PaletteProviderProps = {
  workspaces: MyWorkspace[];
  currentWorkspaceId: string | null;
  children: React.ReactNode;
};

/**
 * The command palette and its Cmd+K and Ctrl+K shortcut (KRB-212). The search
 * buttons and the workspace switcher of the server-rendered shell open it
 * through usePalette.
 */
export function PaletteProvider({ workspaces, currentWorkspaceId, children }: PaletteProviderProps) {
  const [isOpen, setOpen] = useState(false);
  // Stays mounted once opened, so it can play its closing animation.
  const [mounted, setMounted] = useState(false);
  const [scope, setScope] = useState<PaletteScope>("all");
  const isOpenRef = useRef(false);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const open = useCallback((next: PaletteScope) => {
    setScope(next);
    setMounted(true);
    setOpen(true);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (isOpenRef.current) {
          setOpen(false);
        } else {
          open("all");
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const value = useMemo(() => ({ open, isOpen }), [open, isOpen]);

  return (
    <PaletteContext.Provider value={value}>
      {children}
      {mounted ? (
        <CommandPalette
          open={isOpen}
          onOpenChange={setOpen}
          scope={scope}
          workspaces={workspaces}
          currentWorkspaceId={currentWorkspaceId}
        />
      ) : null}
    </PaletteContext.Provider>
  );
}
