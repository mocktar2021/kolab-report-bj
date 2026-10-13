"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { EASE_OUT_EXPO } from "./tokens";

type CountUpProps = {
  value: number;
  className?: string;
  /** Seconds the count takes to reach value. */
  duration?: number;
};

/**
 * Counts from 0 to value when the number scrolls into view. The server HTML
 * and screen readers always get the final value.
 */
export function CountUp({ value, className, duration = 1.4 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const prefersReducedMotion = useReducedMotion();
  const formatter = useMemo(
    () => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }),
    [],
  );
  const count = useMotionValue(value);
  const text = useTransform(count, (latest) => formatter.format(Math.round(latest)));

  useEffect(() => {
    if (prefersReducedMotion) {
      count.jump(value);
      return;
    }
    if (!inView) {
      count.jump(0);
      return;
    }
    const controls = animate(count, value, { duration, ease: EASE_OUT_EXPO });
    return () => controls.stop();
  }, [count, duration, inView, prefersReducedMotion, value]);

  return (
    <span className={className}>
      <motion.span ref={ref} aria-hidden="true" className="tabular-nums">
        {text}
      </motion.span>
      <span className="sr-only">{formatter.format(value)}</span>
    </span>
  );
}
