import { ClientMessages } from "@/i18n/client-messages-provider";
import { ImageInsertProvider } from "./image-insert";

// Sends the messages of the section editor, deliverables and AI drafts to the browser (src/i18n/client-messages.ts).
// ImageInsertProvider lets "Insérer dans le texte" in the deliverable list reach the editor (KRB-216).
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
      <ImageInsertProvider>{children}</ImageInsertProvider>
    </ClientMessages>
  );
}
