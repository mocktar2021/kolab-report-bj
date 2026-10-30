# SEO

How kolabreport.com shows up on Google and Bing, and what to keep up to date. Epic KRB-257. Free tools only.

## What the app does (KRB-258)

| Piece | Where | What it does |
| --- | --- | --- |
| `/robots.txt` | `src/app/robots.ts` | Production: crawlers may read the public pages, not the signed-in app, the account pages or `/api`. It names the sitemap. Any other build (staging, previews, local) shuts every crawler out. |
| `/sitemap.xml` | `src/app/sitemap.ts` | The 9 public pages, with full addresses: home, tarifs, guide, inscription and the five legal pages. |
| Canonical address | `publicPageMetadata` in `src/lib/seo/metadata.ts` | Each public page names its own address, so `?next=` or other query strings never make a second copy. |
| Link previews | same helper | Title, description and image for WhatsApp, LinkedIn, Facebook and X. |
| noindex | `src/app/[locale]/(app)/layout.tsx`, password pages, offline page | Signed-in pages and one-time pages stay out of results. |

Production is decided at build time: `APP_ENV=production`, or `VERCEL_ENV=production` when `APP_ENV` is not set. Staging is built as a Vercel preview, so it never counts.

The public pages and the private paths are listed once, in `src/lib/seo/site.ts`. A new public page needs three things:

1. Its path in `INDEXED_PATHS`, so it joins the sitemap.
2. `publicPageMetadata` in its `generateMetadata`.
3. Its path in the proxy's `PUBLIC_PATHS` (`src/proxy.ts`), or crawlers land on the sign-in page.

## The preview image

`public/og/kolabreport.png`, 1200 by 630. Drawn by `scripts/generate-og-image.mjs` from the logo and the landing page tagline. After changing either, run `node scripts/generate-og-image.mjs` and commit the new image.

To see what a shared link looks like, paste a page address into the LinkedIn Post Inspector or the Facebook Sharing Debugger. Both are free. They keep a copy for a while, so ask them to scrape again after a change.

## Structured data (KRB-259)

The home page and the pricing page carry a `<script type="application/ld+json">` that tells search engines, in schema.org terms:

| Node | Pages | Content |
| --- | --- | --- |
| `Organization` | both | Mocktar Technologies, its site, support e-mail and address, and the KolabReport brand with its logo. From `src/content/legal/publisher.ts`. |
| `WebSite` | home | The site name KolabReport, which Google can show above the result. |
| `WebApplication` | both | What KolabReport is, and every offer sold online with its price in FCFA, from `src/lib/billing/catalog.ts`. Institution has no price, since it is sold on quote. |
| `FAQPage` | both | The questions and answers the page shows, from `messages/fr.json`. |

The code is in `src/lib/seo/structured-data.ts`. The FAQ question lists live in `src/content/site-faq.ts`, read by the pages and the structured data alike, so a question added to a page reaches search engines with no other change. A new price in the catalogue does the same.

Closed FAQ answers stay in the page HTML, hidden, so search engines read them without opening the accordion.

What to expect from Google:

- FAQ rich results: since August 2023 Google shows them only for well-known government and health sites. The FAQ still helps Bing and AI answer engines.
- Software rich results (stars and price under the result): Google asks for a rating or reviews. We have none yet and must not invent any. When real customer reviews exist, they can be added.

To check the data after a production deploy, paste `https://kolabreport.com/fr` and `https://kolabreport.com/fr/tarifs` into the Rich Results Test (search.google.com/test/rich-results) and the Schema Markup Validator (validator.schema.org). Both are free.

## Still to do

- KRB-260: verify the site in Google Search Console and Bing Webmaster Tools, then send the sitemap.
- KRB-261: titles and descriptions for the searches buyers make.
- KRB-262: one page per use case.
- KRB-263: free directory listings.
