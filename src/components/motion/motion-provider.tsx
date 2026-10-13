"use client";

import { MotionConfig } from "motion/react";
import { enterTransition } from "./tokens";

// reducedMotion="user" turns transform and layout animations off when the
// visitor has asked the OS for reduced motion. Opacity fades still run.
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={enterTransition}>
      {children}
    </MotionConfig>
  );
}
