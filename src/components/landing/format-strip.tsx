import { useTranslations } from "next-intl";
import { FileImage, FileSpreadsheet, FileText, FileType2, Presentation, Workflow } from "lucide-react";
import { FadeIn } from "@/components/motion/fade-in";

// Formats accepted by the deliverables bucket (see the FAQ answer). Shown
// where a template would put customer logos: we list what experts can drop.
const FORMATS = [
  { key: "word", icon: FileText },
  { key: "excel", icon: FileSpreadsheet },
  { key: "powerpoint", icon: Presentation },
  { key: "pdf", icon: FileType2 },
  { key: "images", icon: FileImage },
  { key: "drawio", icon: Workflow },
] as const;

export function FormatStrip() {
  const t = useTranslations("Landing.formats");

  return (
    <section aria-labelledby="formats-title" className="mx-auto max-w-5xl px-4 pt-16 sm:px-6 sm:pt-24">
      <FadeIn>
        <h2 id="formats-title" className="text-center font-sans text-sm font-normal text-muted-foreground">
          {t("title")}
        </h2>
        <ul className="mx-auto mt-7 grid max-w-sm grid-cols-3 gap-x-4 gap-y-6 sm:flex sm:max-w-none sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-12">
          {FORMATS.map(({ key, icon: Icon }) => (
            <li
              key={key}
              className="flex flex-col items-center gap-2 text-muted-foreground sm:flex-row sm:gap-2.5"
            >
              <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} />
              <span className="font-display text-base font-medium tracking-[-0.02em] sm:text-xl">
                {t(`items.${key}`)}
              </span>
            </li>
          ))}
        </ul>
      </FadeIn>
    </section>
  );
}
