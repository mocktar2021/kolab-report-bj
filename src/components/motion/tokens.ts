import type { Transition, Variants } from "motion/react";

// Shared motion values so every entrance moves the same way.
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

export const ENTER_DISTANCE = 16;

export const enterTransition: Transition = { duration: 0.7, ease: EASE_OUT_EXPO };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: ENTER_DISTANCE },
  show: { opacity: 1, y: 0, transition: enterTransition },
};

// Elements rendered with this attribute start hidden on the server. The
// landing page adds a <noscript> rule that reveals them without JavaScript.
export const REVEAL_ATTRIBUTE = { "data-reveal": "" } as const;
