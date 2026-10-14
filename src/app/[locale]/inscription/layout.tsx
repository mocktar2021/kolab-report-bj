import { ClientMessages } from "@/i18n/client-messages-provider";

// Sends the messages of the sign-up form to the browser (src/i18n/client-messages.ts).
export default async function InscriptionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <ClientMessages locale={locale} scope="auth">
      {children}
    </ClientMessages>
  );
}
