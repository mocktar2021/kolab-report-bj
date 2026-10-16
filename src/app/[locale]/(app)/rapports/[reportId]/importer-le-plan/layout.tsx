import { ClientMessages } from "@/i18n/client-messages-provider";

// Sends the messages of the plan import page to the browser (src/i18n/client-messages.ts).
export default async function ImportPlanLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <ClientMessages locale={locale} scope="planImport">
      {children}
    </ClientMessages>
  );
}
