import { ClientMessages } from "@/i18n/client-messages-provider";

// Sends the messages of the member and invitation lists to the browser (src/i18n/client-messages.ts).
export default async function MembresLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <ClientMessages locale={locale} scope="members">
      {children}
    </ClientMessages>
  );
}
