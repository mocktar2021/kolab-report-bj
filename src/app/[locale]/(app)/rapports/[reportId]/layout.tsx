import { ClientMessages } from "@/i18n/client-messages-provider";

// Sends the messages of the master report to the browser (src/i18n/client-messages.ts).
export default async function RapportLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <ClientMessages locale={locale} scope="report">
      {children}
    </ClientMessages>
  );
}
