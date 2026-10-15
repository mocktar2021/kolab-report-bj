import { ClientMessages } from "@/i18n/client-messages-provider";

// Sends the messages of the account forms to the browser (src/i18n/client-messages.ts).
export default async function CompteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <ClientMessages locale={locale} scope="account">
      {children}
    </ClientMessages>
  );
}
