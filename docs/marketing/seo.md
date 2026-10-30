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

## Still to do

- KRB-259: structured data (organization, software and prices, FAQ).
- KRB-260: verify the site in Google Search Console and Bing Webmaster Tools, then send the sitemap.
- KRB-261: titles and descriptions for the searches buyers make.
- KRB-262: one page per use case.
- KRB-263: free directory listings.
