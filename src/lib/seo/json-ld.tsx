// Structured data for search engines (KRB-259), in a plain script tag as the
// Next.js guide on JSON-LD advises. The browser never runs it.

/** JSON for a script tag: `<`, `>` and `&` become unicode escapes, so no text can close the tag. */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
