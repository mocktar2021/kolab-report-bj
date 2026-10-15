import { ClientMessages } from "@/i18n/client-messages-provider";

// Sends the messages of the checkout forms and the return page to the browser (src/i18n/client-messages.ts).
export default async function AbonnementLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <ClientMessages locale={locale} scope="billing">
      {children}
    </ClientMessages>
  );
}
