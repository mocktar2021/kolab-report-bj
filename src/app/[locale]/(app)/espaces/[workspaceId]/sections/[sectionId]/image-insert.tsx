"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// "Insérer dans le texte" in the deliverable list (KRB-216) puts an image in
// the section editor, a sibling further up the page. The provider holds the
// editor's insert function while the editor is on the page.

export type SectionImageRef = { id: string; caption: string };

type InsertImage = (image: SectionImageRef) => void;

type Target = {
  set: (insert: InsertImage | null) => void;
  get: () => InsertImage | null;
};

function createTarget(): Target {
  let current: InsertImage | null = null;
  return {
    set: (insert) => {
      current = insert;
    },
    get: () => current,
  };
}

const ImageInsertContext = createContext<Target | null>(null);

export function ImageInsertProvider({ children }: { children: ReactNode }) {
  const [target] = useState(createTarget);
  return <ImageInsertContext value={target}>{children}</ImageInsertContext>;
}

/** For the editor: `insert` takes the images of the list while the editor is mounted. */
export function useImageInsertTarget(insert: InsertImage) {
  const target = useContext(ImageInsertContext);
  const latest = useRef(insert);
  useEffect(() => {
    latest.current = insert;
  });
  useEffect(() => {
    if (!target) return;
    const forward: InsertImage = (image) => latest.current(image);
    target.set(forward);
    return () => {
      if (target.get() === forward) target.set(null);
    };
  }, [target]);
}

/** For the list: puts an image in the editor, or null outside a provider. */
export function useImageInsert(): InsertImage | null {
  const target = useContext(ImageInsertContext);
  const insert = useCallback((image: SectionImageRef) => target?.get()?.(image), [target]);
  return target ? insert : null;
}
