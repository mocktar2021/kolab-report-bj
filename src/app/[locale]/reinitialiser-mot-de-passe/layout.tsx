import { ClientMessages } from "@/i18n/client-messages-provider";

// Sends the messages of the new password form to the browser (src/i18n/client-messages.ts).
export default async function ReinitialiserMotDePasseLayout({
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
