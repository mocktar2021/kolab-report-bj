import { hasLocale, type Formats } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export const formats = {
  dateTime: {
    short: { day: "2-digit", month: "2-digit", year: "numeric" },
    long: { day: "numeric", month: "long", year: "numeric" },
  },
  number: {
    percent: { style: "percent", maximumFractionDigits: 0 },
  },
} satisfies Formats;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    timeZone: "Africa/Porto-Novo",
    formats,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
