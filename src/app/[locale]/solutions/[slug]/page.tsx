import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { UseCasePage } from "@/components/use-cases/use-case-page";
import { findUseCase, USE_CASES, solutionPath } from "@/content/use-cases/pages";
import type { Locale } from "@/i18n/routing";
import { publicPageMetadata } from "@/lib/seo/metadata";

// One public page per kind of report (KRB-262), prerendered at build time
// like the pricing page. Any other slug is a 404.
type Props = { params: Promise<{ locale: Locale; slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return USE_CASES.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const useCase = findUseCase(slug);
  if (!useCase) return {};
  return publicPageMetadata({
    locale,
    path: solutionPath(useCase.slug),
    title: useCase.metaTitle,
    description: useCase.metaDescription,
  });
}

export default async function UseCaseRoute({ params }: Props) {
  const { locale, slug } = await params;
  const useCase = findUseCase(slug);
  if (!useCase) notFound();
  setRequestLocale(locale);
  return <UseCasePage useCase={useCase} />;
}
