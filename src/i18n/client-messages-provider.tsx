import { hasLocale, NextIntlClientProvider, type Messages } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { CLIENT_MESSAGE_SCOPES, pickMessages, type ClientMessageScope } from "./client-messages";
import { routing } from "./routing";

/**
 * Sends the messages of one scope to the Client Components below it
 * (src/i18n/client-messages.ts). Server Components keep reading every
 * message through getTranslations.
 */
export async function ClientMessages({
  locale: requested,
  scope,
  children,
}: {
  locale: string;
  scope: ClientMessageScope;
  children: React.ReactNode;
}) {
  // app/[locale]/layout.tsx already answers 404 for an unknown locale.
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  // Layouts render in parallel with their page: without this, next-intl
  // would read the locale from the request headers and the static pages
  // (landing, sign-up) would become dynamic.
  setRequestLocale(locale);
  const messages = await getMessages({ locale });

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={pickMessages(messages, CLIENT_MESSAGE_SCOPES[scope]) as Partial<Messages>}
    >
      {children}
    </NextIntlClientProvider>
  );
}
