"use client";

import { LazyMotion } from "motion/react";
import * as m from "motion/react-m";
import layoutFeatures from "@/components/motion/layout-features";

const spring = { type: "spring", stiffness: 500, damping: 40 } as const;

/**
 * The highlight of the active link, sliding from one link to the next. Its
 * own chunk with motion's layout features (about 30 kB compressed), loaded
 * when the pointer or the focus first reaches the sidebar (nav-items.tsx).
 */
export function SlidingHighlight({
  variant,
  backgroundClassName,
  barClassName,
}: {
  variant: string;
  backgroundClassName: string;
  barClassName: string;
}) {
  return (
    <LazyMotion features={layoutFeatures}>
      <m.span
        layoutId={`${variant}-nav-active`}
        aria-hidden="true"
        className={backgroundClassName}
        transition={spring}
      />
      <m.span
        layoutId={`${variant}-nav-bar`}
        aria-hidden="true"
        className={barClassName}
        transition={spring}
      />
    </LazyMotion>
  );
}
