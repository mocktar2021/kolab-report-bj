import { useTranslations } from "next-intl";
import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/** Closing band: ember light and a grid floor in perspective under the text. */
export function CallToAction() {
  const t = useTranslations("Landing.cta");

  return (
    <section aria-labelledby="cta-title" className="relative isolate mt-28 overflow-hidden sm:mt-36">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-glow-bottom" />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-[62%] [perspective:420px]">
        <div className="bg-floor-grid absolute inset-x-[-60%] bottom-0 h-[180%] origin-bottom [mask-image:linear-gradient(to_top,#000_5%,transparent_70%)] [transform:rotateX(64deg)]" />
      </div>

      <FadeIn className="mx-auto max-w-4xl px-4 pb-40 pt-20 text-center sm:px-6 sm:pb-56 sm:pt-28">
        <h2 id="cta-title" className="text-h1 text-foreground">
          {t("title")}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lead text-muted-foreground">{t("subtitle")}</p>
        <Button asChild size="lg" shape="pill" className="mt-9 h-12 px-7">
          <Link href="/connexion">{t("button")}</Link>
        </Button>
      </FadeIn>
    </section>
  );
}
