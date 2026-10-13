import { useTranslations } from "next-intl";
import { Check, FileImage, FileSpreadsheet, FileText, Sparkles, WifiOff, Workflow } from "lucide-react";
import { FadeIn } from "@/components/motion/fade-in";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

// Visual panels are decorative (aria-hidden): the title and description of
// each tile carry the information.
const panelClass =
  "relative flex min-h-64 items-center justify-center overflow-hidden border-b border-border/70 bg-gradient-to-b from-zinc-50 to-white px-6 py-6";

const dotGrid =
  "pointer-events-none absolute inset-0 bg-[radial-gradient(rgb(9_9_11/0.07)_1px,transparent_1px)] [background-size:14px_14px] [mask-image:radial-gradient(ellipse_at_center,#000_30%,transparent_75%)]";

function Tile({
  title,
  description,
  panel,
  className,
}: {
  title: string;
  description: string;
  panel: React.ReactNode;
  className?: string;
}) {
  return (
    <StaggerItem
      as="li"
      className={cn("flex flex-col overflow-hidden rounded-3xl border-gradient shadow-sm", className)}
    >
      <div aria-hidden="true" className={panelClass}>
        <div className={dotGrid} />
        {panel}
      </div>
      <div className="p-6 sm:p-7">
        <h3 className="text-h3">{title}</h3>
        <p className="mt-2 text-small text-muted-foreground">{description}</p>
      </div>
    </StaggerItem>
  );
}

function MiniAvatar({ initials, tone }: { initials: string; tone: string }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
        tone,
      )}
    >
      {initials}
    </span>
  );
}

function AssignPanel() {
  const t = useTranslations("Landing.features.assign");
  const rowClass =
    "flex items-center gap-3 rounded-xl border bg-white px-3 py-2.5 text-[13px] shadow-sm";

  return (
    <div className="relative w-full max-w-sm space-y-2">
      <div className={rowClass}>
        <span className="w-4 text-right tabular-nums text-zinc-400">1</span>
        <span className="font-medium">{t("one")}</span>
        <span className="ml-auto">
          <MiniAvatar initials="AK" tone="bg-zinc-900 text-white" />
        </span>
      </div>
      <div className={rowClass}>
        <span className="w-4 text-right tabular-nums text-zinc-400">2</span>
        <span className="font-medium">{t("two")}</span>
        <span className="ml-auto">
          <MiniAvatar initials="MB" tone="bg-zinc-200 text-zinc-800" />
        </span>
      </div>
      <div className={cn(rowClass, "ring-1 ring-zinc-900/10")}>
        <span className="w-4 text-right tabular-nums text-zinc-400">3</span>
        <span className="font-medium">{t("three")}</span>
        <span className="relative ml-auto flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground motion-safe:animate-fade-out-hold motion-reduce:hidden">
            {t("pending")}
          </span>
          <span className="relative size-7">
            <span className="absolute inset-0 rounded-full border border-dashed border-zinc-300 motion-safe:animate-fade-out-hold motion-reduce:hidden" />
            <span className="absolute inset-0 motion-safe:animate-assign-drop">
              <MiniAvatar initials="FD" tone="bg-zinc-700 text-white" />
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}

const FILES = [
  { key: "docx", icon: FileText, size: "docxSize" },
  { key: "xlsx", icon: FileSpreadsheet, size: null },
  { key: "png", icon: FileImage, size: "pngSize" },
  { key: "drawio", icon: Workflow, size: "drawioSize" },
] as const;

function DeliverablesPanel() {
  const t = useTranslations("Landing.features.deliverables");

  return (
    <ul className="relative w-full max-w-[17rem] space-y-1.5">
      {FILES.map(({ key, icon: Icon, size }) => (
        <li
          key={key}
          className="flex items-center gap-2.5 rounded-xl border bg-white px-2.5 py-1.5 text-xs shadow-sm"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
            <Icon className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{t(key)}</span>
            {size ? (
              <span className="block text-[11px] tabular-nums text-muted-foreground">{t(size)}</span>
            ) : (
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-zinc-100">
                <span className="block h-full origin-left rounded-full bg-zinc-900 motion-safe:animate-upload motion-reduce:w-3/4" />
              </span>
            )}
          </span>
          {size ? <Check className="size-3.5 shrink-0 text-emerald-600" /> : null}
        </li>
      ))}
    </ul>
  );
}

function AiPanel() {
  const t = useTranslations("Landing.features.ai");
  const lines = ["w-full", "w-11/12", "w-full", "w-2/3"];

  return (
    <div className="relative w-full max-w-[17rem]">
      <span className="inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-[11px] font-medium shadow-sm">
        <Sparkles className="size-3" />
        {t("prompt")}
      </span>
      <div className="mt-2 rounded-xl border bg-white p-3.5 shadow-sm">
        <div className="space-y-2">
          {lines.map((width, index) => (
            <span key={index} className={cn("flex h-2 items-center", width)}>
              <span
                className="block h-full w-full origin-left rounded-full bg-zinc-200 motion-safe:animate-grow-x motion-safe:fill-mode-backwards"
                style={{ animationDelay: `${index * 450}ms` }}
              />
            </span>
          ))}
        </div>
        <span className="mt-2 block h-3.5 w-0.5 rounded-full bg-zinc-900 motion-safe:animate-caret" />
      </div>
    </div>
  );
}

function MasterPanel() {
  const t = useTranslations("Landing.features.master");
  const sections = useTranslations("Landing.mockup.sections");

  return (
    <div className="relative w-full max-w-md rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{t("progress")}</span>
        <span className="relative tabular-nums font-semibold">
          <span className="motion-safe:animate-fade-out-hold motion-reduce:hidden">{t("before")}</span>
          <span className="absolute right-0 top-0 motion-safe:animate-fade-in-hold motion-reduce:static">
            {t("after")}
          </span>
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full w-full origin-left scale-x-[0.8] rounded-full bg-zinc-900 motion-safe:animate-progress-step" />
      </div>
      <ul className="mt-4 space-y-2 text-[13px]">
        <li className="flex items-center justify-between gap-3">
          <span className="truncate">{sections("summary")}</span>
          <StatusBadge status="completed" />
        </li>
        <li className="flex items-center justify-between gap-3">
          <span className="truncate">{sections("analysis")}</span>
          <span className="relative">
            <span className="motion-safe:animate-fade-out-hold motion-reduce:hidden">
              <StatusBadge status="in_progress" />
            </span>
            <span className="absolute right-0 top-0 motion-safe:animate-fade-in-hold motion-reduce:static">
              <StatusBadge status="completed" />
            </span>
          </span>
        </li>
        <li className="flex items-center justify-between gap-3">
          <span className="truncate">{sections("finance")}</span>
          <StatusBadge status="in_progress" />
        </li>
        <li className="flex items-center justify-between gap-3">
          <span className="truncate">{sections("recommendations")}</span>
          <StatusBadge status="not_started" />
        </li>
      </ul>
    </div>
  );
}

function OfflinePanel() {
  const t = useTranslations("Landing.features.offline");

  return (
    <div className="relative flex flex-col items-center gap-4">
      <span className="relative flex size-14 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-zinc-300 motion-safe:animate-ripple" />
        <span className="absolute inset-0 rounded-full border border-zinc-300 motion-safe:animate-ripple motion-safe:[animation-delay:1.4s]" />
        <span className="relative flex size-14 items-center justify-center rounded-full border bg-white shadow-sm">
          <WifiOff className="size-5 text-zinc-700" />
        </span>
      </span>
      <span className="flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-[11px] shadow-sm">
        <span className="size-1.5 rounded-full bg-zinc-400" />
        <span className="font-medium">{t("badge")}</span>
        <span className="text-muted-foreground">{t("cached")}</span>
      </span>
    </div>
  );
}

export function FeatureBento() {
  const t = useTranslations("Landing.features");

  return (
    <section
      id="fonctionnalites"
      aria-labelledby="features-title"
      className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20 sm:px-6 sm:py-28"
    >
      <FadeIn className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-medium text-muted-foreground">{t("eyebrow")}</p>
        <h2 id="features-title" className="mt-3 text-h1">
          {t("title")}
        </h2>
        <p className="mt-4 text-lead text-muted-foreground">{t("subtitle")}</p>
      </FadeIn>

      <Stagger as="ul" className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3" step={0.1}>
        <Tile
          className="md:col-span-2"
          title={t("assign.title")}
          description={t("assign.description")}
          panel={<AssignPanel />}
        />
        <Tile
          title={t("deliverables.title")}
          description={t("deliverables.description")}
          panel={<DeliverablesPanel />}
        />
        <Tile title={t("ai.title")} description={t("ai.description")} panel={<AiPanel />} />
        <Tile
          className="md:col-span-2"
          title={t("master.title")}
          description={t("master.description")}
          panel={<MasterPanel />}
        />
        <StaggerItem
          as="li"
          className="grid overflow-hidden rounded-3xl border-gradient shadow-sm md:col-span-2 md:grid-cols-[1fr_18rem] lg:col-span-3 lg:grid-cols-[1fr_24rem]"
        >
          <div className="flex flex-col justify-center p-6 sm:p-7 md:order-first">
            <h3 className="text-h3">{t("offline.title")}</h3>
            <p className="mt-2 max-w-xl text-small text-muted-foreground">
              {t("offline.description")}
            </p>
          </div>
          <div
            aria-hidden="true"
            className={cn(panelClass, "order-first min-h-48 md:order-none md:min-h-44 md:border-b-0 md:border-l")}
          >
            <div className={dotGrid} />
            <OfflinePanel />
          </div>
        </StaggerItem>
      </Stagger>
    </section>
  );
}
