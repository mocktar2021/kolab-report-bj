import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export function CallToAction() {
  const t = useTranslations("Landing.cta");

  return (
    <section aria-labelledby="cta-title" className="px-4 sm:px-6">
      <FadeIn className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-zinc-950 px-6 py-16 text-center shadow-xl sm:px-12 sm:py-20">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgb(255_255_255/0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.06)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(ellipse_60%_70%_at_50%_0%,#000_30%,transparent_100%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 -top-32 -z-10 mx-auto h-64 max-w-xl rounded-full bg-white/10 blur-3xl"
        />
        <h2 id="cta-title" className="mx-auto max-w-2xl text-h1 text-white">
          {t("title")}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lead text-zinc-400">{t("subtitle")}</p>
        <Button
          asChild
          size="lg"
          shape="pill"
          className="group mt-8 ring-1 ring-white/15 focus-visible:ring-offset-zinc-950"
        >
          <Link href="/connexion">
            {t("button")}
            <ArrowRight
              aria-hidden="true"
              className="transition-transform duration-300 ease-out-expo motion-safe:group-hover:translate-x-0.5"
            />
          </Link>
        </Button>
      </FadeIn>
    </section>
  );
}
