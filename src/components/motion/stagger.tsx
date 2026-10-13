"use client";

import { motion, type Variants } from "motion/react";
import { REVEAL_ATTRIBUTE, fadeUp } from "./tokens";

const TAGS = {
  div: motion.div,
  ul: motion.ul,
  ol: motion.ol,
  li: motion.li,
} as const;

type Tag = keyof typeof TAGS;

type StaggerProps = {
  children: React.ReactNode;
  as?: Tag;
  className?: string;
  /** Seconds between two children. */
  step?: number;
  /** Seconds before the first child starts. */
  delay?: number;
  /** Share of the container that must be visible before it animates (0 to 1). */
  amount?: number;
};

/**
 * Reveals its StaggerItem children one after the other, the first time the
 * container scrolls into view.
 */
export function Stagger({
  children,
  as = "div",
  className,
  step = 0.08,
  delay = 0,
  amount = 0.15,
}: StaggerProps) {
  const Component = TAGS[as];
  const variants: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: step, delayChildren: delay } },
  };

  return (
    <Component
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
    >
      {children}
    </Component>
  );
}

type StaggerItemProps = {
  children: React.ReactNode;
  as?: Tag;
  className?: string;
};

export function StaggerItem({ children, as = "div", className }: StaggerItemProps) {
  const Component = TAGS[as];

  return (
    <Component {...REVEAL_ATTRIBUTE} className={className} variants={fadeUp}>
      {children}
    </Component>
  );
}
