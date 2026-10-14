import { cn } from "@/lib/utils";

const WIDTH = 260;
const HEIGHT = 340;
const CENTER = HEIGHT / 2;
const LINE_COUNT = 7;

// Each thread starts at the page edge and bends toward the middle, where the
// threads run closer together: several experts, one report. The curves are
// computed once at module load.
const PATHS = Array.from({ length: LINE_COUNT }, (_, index) => {
  const start = 24 + index * ((HEIGHT - 48) / (LINE_COUNT - 1));
  const end = CENTER + (start - CENTER) * 0.38;
  const bendAt = 64 + Math.abs(index - (LINE_COUNT - 1) / 2) * 14;
  const run = Math.abs(start - end) * 0.9 + 12;
  const middle = bendAt + run / 2;
  return `M0 ${start} H${bendAt} C${middle} ${start} ${middle} ${end} ${bendAt + run} ${end} H${WIDTH}`;
});

type EdgeLinesProps = {
  side: "left" | "right";
  className?: string;
};

// The light on each thread starts at its own moment and pace, so the threads
// never pulse together. Negative delays: it is already moving at first paint.
const RUNS = PATHS.map((d, index) => ({
  d,
  style: { animationDelay: `${-index * 1.1}s`, animationDuration: `${5.5 + (index % 3) * 0.9}s` },
}));

/**
 * Thin decorative lines at the left or right edge of a section. A light runs
 * along each one toward the content: ink on the light theme, gold on the dark
 * one (KRB-167). CSS only, and still when the visitor asks for less motion.
 */
export function EdgeLines({ side, className }: EdgeLinesProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      fill="none"
      className={cn(
        "text-edge-line pointer-events-none absolute h-[340px] w-[260px]",
        side === "left"
          ? "left-0 [mask-image:linear-gradient(to_right,#000_45%,transparent)]"
          : "right-0 -scale-x-100 [mask-image:linear-gradient(to_right,#000_45%,transparent)]",
        className,
      )}
    >
      {PATHS.map((d) => (
        <path key={d} d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ))}
      {RUNS.map(({ d, style }) => (
        <g key={d}>
          <path d={d} pathLength={1} className="edge-line-run edge-line-run-glow" style={style} />
          <path d={d} pathLength={1} className="edge-line-run edge-line-run-core" style={style} />
        </g>
      ))}
    </svg>
  );
}
