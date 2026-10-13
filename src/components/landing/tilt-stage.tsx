"use client";

import { useEffect, useRef } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { EASE_OUT_EXPO, REVEAL_ATTRIBUTE } from "@/components/motion/tokens";
import { cn } from "@/lib/utils";

const RESTING_TILT_DEG = 7;
const ENTRY_TILT_DEG = 20;
const POINTER_TILT_DEG = 5;

type TiltStageProps = {
  children: React.ReactNode;
  className?: string;
};

/**
 * Perspective stage for the hero mockup. It settles from a steep tilt on
 * load, floats gently, and follows a mouse pointer by a few degrees. Touch
 * and reduced motion keep it still.
 */
export function TiltStage({ children, className }: TiltStageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const baseTilt = useMotionValue(ENTRY_TILT_DEG);
  const pointerX = useSpring(0, { stiffness: 140, damping: 20, mass: 0.6 });
  const pointerY = useSpring(0, { stiffness: 140, damping: 20, mass: 0.6 });
  const rotateX = useTransform(() => baseTilt.get() - pointerY.get() * POINTER_TILT_DEG);
  const rotateY = useTransform(() => pointerX.get() * POINTER_TILT_DEG);

  useEffect(() => {
    if (prefersReducedMotion) {
      baseTilt.jump(RESTING_TILT_DEG);
      return;
    }
    const controls = animate(baseTilt, RESTING_TILT_DEG, {
      duration: 1.6,
      delay: 0.25,
      ease: EASE_OUT_EXPO,
    });
    return () => controls.stop();
  }, [baseTilt, prefersReducedMotion]);

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (prefersReducedMotion || event.pointerType !== "mouse" || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    pointerX.set((event.clientX - rect.left) / rect.width - 0.5);
    pointerY.set((event.clientY - rect.top) / rect.height - 0.5);
  }

  function handlePointerLeave() {
    pointerX.set(0);
    pointerY.set(0);
  }

  return (
    <motion.div
      {...REVEAL_ATTRIBUTE}
      className={className}
      initial={{ opacity: 0, y: 48 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1.2, delay: 0.25, ease: EASE_OUT_EXPO }}
    >
      <div className={cn("[perspective:2400px]", "motion-safe:animate-float")}>
        <motion.div
          ref={ref}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          style={{ rotateX, rotateY, transformOrigin: "50% 100%" }}
          className="relative"
        >
          {children}
        </motion.div>
      </div>
    </motion.div>
  );
}
