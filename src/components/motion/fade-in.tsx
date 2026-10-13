"use client";

import { motion } from "motion/react";
import { ENTER_DISTANCE, REVEAL_ATTRIBUTE, enterTransition } from "./tokens";

const TAGS = {
  div: motion.div,
  section: motion.section,
  header: motion.header,
  li: motion.li,
} as const;

type FadeInProps = {
  children: React.ReactNode;
  as?: keyof typeof TAGS;
  className?: string;
  id?: string;
  /** Seconds to wait once the element is in view. */
  delay?: number;
  /** Vertical distance in pixels the element travels while it fades in. */
  y?: number;
  /** Share of the element that must be visible before it animates (0 to 1). */
  amount?: number;
};

/** Fades and slides an element up the first time it scrolls into view. */
export function FadeIn({
  children,
  as = "div",
  className,
  id,
  delay = 0,
  y = ENTER_DISTANCE,
  amount = 0.2,
}: FadeInProps) {
  const Component = TAGS[as];

  return (
    <Component
      {...REVEAL_ATTRIBUTE}
      id={id}
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{ ...enterTransition, delay }}
    >
      {children}
    </Component>
  );
}
