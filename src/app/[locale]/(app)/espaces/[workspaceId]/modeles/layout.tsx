import { ClientMessages } from "@/i18n/client-messages-provider";

// Sends the messages of the prompt library pages to the browser (src/i18n/client-messages.ts).
export default async function ModelesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <ClientMessages locale={locale} scope="prompts">
      {children}
    </ClientMessages>
  );
}
