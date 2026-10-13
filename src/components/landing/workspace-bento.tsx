import { useTranslations } from "next-intl";
import { Check, Lock, WifiOff } from "lucide-react";
import { FadeIn } from "@/components/motion/fade-in";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { cn } from "@/lib/utils";

const tileClass = "surface-feature relative flex flex-col overflow-hidden rounded-[28px] border";
const visualClass = "relative flex h-56 items-center justify-center sm:h-64";
const titleClass = "text-[1.5rem] font-medium leading-tight tracking-[-0.02em] text-foreground";

const ROLES = ["owner", "admin", "expert", "viewer"] as const;

function RolesVisual() {
  const t = useTranslations("Landing.bento.roles");

  return (
    <ul className="relative flex w-56 flex-col items-stretch gap-2">
      {ROLES.map((role, index) => (
        <li
          key={role}
          style={{ marginLeft: `${index * 14}px`, marginRight: `${(ROLES.length - 1 - index) * 14}px` }}
          className={cn(
            "surface-float flex items-center gap-2.5 rounded-full border px-3.5 py-2 text-[13px]",
            role === "expert" ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              role === "expert" ? "bg-highlight" : "bg-foreground/25",
            )}
          />
          {t(role)}
        </li>
      ))}
    </ul>
  );
}

function OfflineVisual() {
  const t = useTranslations("Landing.bento.offline");

  return (
    <>
      {/* Thin coral arc over a dotted circle. The arc opens at the bottom,
          where the visual area cuts it. */}
      <svg viewBox="0 0 200 200" className="absolute top-6 size-56 sm:size-64" fill="none">
        <circle
          cx="100"
          cy="100"
          r="96"
          pathLength={100}
          strokeDasharray="70 30"
          strokeDashoffset="-40"
          className="stroke-highlight/70"
          strokeWidth="1"
        />
        <circle cx="100" cy="100" r="96" strokeDasharray="1.5 5" className="stroke-foreground/15" strokeWidth="1" />
      </svg>
      <span className="surface-float relative flex size-16 items-center justify-center rounded-2xl border">
        <WifiOff className="size-6 text-foreground" />
      </span>
      <span className="surface-float absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border py-1.5 pl-1.5 pr-4 text-[13px] sm:bottom-10">
        <span className="flex size-6 items-center justify-center rounded-full bg-highlight/15 text-highlight">
          <Check className="size-3.5" strokeWidth={2.5} />
        </span>
        <span className="font-medium">{t("badge")}</span>
        <span className="text-muted-foreground">{t("cached")}</span>
      </span>
    </>
  );
}

function SecurityVisual() {
  // Nested frames: each workspace sits inside its own boundary.
  const frames = [0, 1, 2, 3, 4];

  return (
    <div className="relative flex size-full items-center justify-center [mask-image:radial-gradient(closest-side,#000_55%,transparent)]">
      {frames.map((frame) => (
        <span
          key={frame}
          className="absolute rounded-[2rem] border border-foreground/[0.09]"
          style={{ width: `${8 + frame * 4.5}rem`, height: `${5 + frame * 2.6}rem` }}
        />
      ))}
      <span className="surface-float relative flex size-14 items-center justify-center rounded-2xl border">
        <Lock className="size-5 text-foreground" />
      </span>
    </div>
  );
}

export function WorkspaceBento() {
  const t = useTranslations("Landing.bento");

  return (
    <section aria-labelledby="bento-title" className="mx-auto max-w-6xl px-4 pt-28 sm:px-6 sm:pt-36">
      <FadeIn className="mx-auto max-w-2xl text-center">
        <h2 id="bento-title" className="text-h1 text-foreground">
          {t("title")}
        </h2>
        <p className="mt-4 text-lead text-muted-foreground">{t("subtitle")}</p>
      </FadeIn>

      <Stagger as="ul" className="mt-12 grid gap-5 sm:mt-16 md:grid-cols-2" step={0.08}>
        <StaggerItem as="li" className={tileClass}>
          <div aria-hidden="true" className={visualClass}>
            <RolesVisual />
          </div>
          <div className="relative px-7 pb-8 sm:px-8">
            <h3 className={titleClass}>{t("roles.title")}</h3>
            <p className="mt-2 text-small text-muted-foreground">{t("roles.description")}</p>
          </div>
        </StaggerItem>
        <StaggerItem as="li" className={tileClass}>
          <div aria-hidden="true" className={cn(visualClass, "overflow-hidden")}>
            <OfflineVisual />
          </div>
          <div className="relative px-7 pb-8 sm:px-8">
            <h3 className={titleClass}>{t("offline.title")}</h3>
            <p className="mt-2 text-small text-muted-foreground">{t("offline.description")}</p>
          </div>
        </StaggerItem>
        <StaggerItem as="li" className={cn(tileClass, "md:col-span-2")}>
          <div aria-hidden="true" className={cn(visualClass, "sm:h-60")}>
            <SecurityVisual />
          </div>
          <div className="relative mx-auto max-w-xl px-7 pb-9 text-center sm:px-8">
            <h3 className={titleClass}>{t("security.title")}</h3>
            <p className="mt-2 text-small text-muted-foreground">{t("security.description")}</p>
          </div>
        </StaggerItem>
      </Stagger>
    </section>
  );
}
