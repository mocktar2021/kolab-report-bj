import { ClientMessages } from "@/i18n/client-messages-provider";

// Sends the messages of the section editor, deliverables and AI drafts to the browser (src/i18n/client-messages.ts).
export default async function SectionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <ClientMessages locale={locale} scope="section">
      {children}
    </ClientMessages>
  );
}
