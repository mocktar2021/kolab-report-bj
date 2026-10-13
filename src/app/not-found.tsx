import Link from "next/link";

// Root-level 404 for paths outside the [locale] segment.
export default function NotFound() {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <h1>Page introuvable</h1>
        <p>
          <Link href="/fr/tableau-de-bord">Retour au tableau de bord</Link>
        </p>
      </body>
    </html>
  );
}
