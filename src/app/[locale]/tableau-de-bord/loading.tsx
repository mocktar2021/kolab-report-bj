import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";

const KPI_PLACEHOLDERS = 4;
const ROW_PLACEHOLDERS = 6;

// Same grid as the dashboard page so nothing jumps when the data arrives.
export default function TableauDeBordLoading() {
  const t = useTranslations("Common");

  return (
    <div role="status" aria-live="polite" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <span className="sr-only">{t("loading")}</span>

      <div className="space-y-3">
        <Skeleton className="h-8 w-56 rounded-lg" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: KPI_PLACEHOLDERS }, (_, index) => (
          <div key={index} className="rounded-2xl border bg-card p-5 shadow-sm">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-9 w-16 rounded-lg" />
            <Skeleton className="mt-5 h-3 w-28" />
          </div>
        ))}
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-8 w-64 max-w-[50%] rounded-full" />
        </div>
        <ul className="divide-y">
          {Array.from({ length: ROW_PLACEHOLDERS }, (_, index) => (
            <li key={index} className="flex items-center gap-4 px-5 py-4">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="hidden h-4 w-40 md:block" />
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="hidden h-4 w-28 sm:block" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
