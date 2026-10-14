"use client";

import messages from "../../messages/fr.json";
import { ErrorScreen } from "@/components/errors/error-screen";
import "./globals.css";

// Last resort, when the [locale] layout itself fails. It replaces the whole
// document, so there is no next-intl provider: the texts come straight from
// messages/fr.json.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const t = messages.Errors;

  return (
    <html lang="fr">
      <body className="min-h-dvh">
        <ErrorScreen
          error={error}
          title={t.title}
          description={t.description}
          reloadLabel={t.reload}
          homeLabel={t.home}
          reference={error.digest ? t.reference.replace("{digest}", error.digest) : undefined}
        />
      </body>
    </html>
  );
}
