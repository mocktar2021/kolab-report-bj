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

## Target searches (KRB-261)

The searches we want the public pages to answer, in French. They are a first guess from what buyers in Benin, Togo and Côte d'Ivoire call their work: no free tool gave search volumes. Search Console (KRB-260) will show the real queries after a few weeks, and this list changes with it.

| Search | Page |
| --- | --- |
| logiciel rapport d'audit | home |
| rédaction rapport d'audit en équipe | home |
| rédaction rapport d'évaluation, rapport d'évaluation de projet | home |
| outil collaboratif rapport cabinet, rédaction collaborative de rapport | home |
| logiciel bureau d'études rapport, rapport d'étude | home |
| rédiger un rapport avec l'IA | home |
| prix logiciel rapport FCFA, abonnement Mobile Money | tarifs |
| any of the above with Bénin, Cotonou, Togo, Lomé, Côte d'Ivoire or Abidjan | home, tarifs |

We avoid "rapport d'expertise" as a lead term: in French search it mostly means insurance, car and court experts, who are not our buyers.

What each page says:

| Page | Title | Description |
| --- | --- | --- |
| Home | KolabReport : rapports d'audit et d'évaluation en équipe | Cabinets et bureaux d'études, one section per expert, the AI first draft, Word and PDF, the free trial |
| Tarifs | Tarifs en FCFA, essai gratuit de 14 jours | The Indépendant, Cabinet and Pass Mission prices, free readers, Mobile Money |
| Guide | Guide d'utilisation, rôle par rôle | What the guide covers |

The home headline keeps its line ("Une section par expert. Un seul rapport à livrer."), with a short line above it in the same H1: "Rapports d'audit, d'évaluation et d'étude".

Prices and the trial length in this copy come from the catalogue (`src/lib/seo/copy.ts`). `src/lib/seo/copy.test.ts` fails when a title passes 60 characters or a description 155, the most Google shows in full.

## Use-case pages (KRB-262)

Three public pages, one per kind of report:

| Page | Path | Screenshot |
| --- | --- | --- |
| Rapports d'audit | `/fr/solutions/rapport-d-audit` | Report table of contents |
| Rapports d'évaluation | `/fr/solutions/rapport-d-evaluation` | AI draft |
| Rapports d'études | `/fr/solutions/rapport-d-etude` | Section deliverables |

Each one says who it is for, shows an example plan with who writes each section, what the AI does with the deliverables, a guide screenshot and the trial button. The landing page links to them between the features and the FAQ, and the footer has a "Cas d'usage" column.

All their text is in `src/content/use-cases/pages.ts`, so it reads as one document. Every claim there matches the guide: when a feature changes, update the guide, then these pages. `pages.test.ts` checks the title and description lengths, French spacing and that each page is in the sitemap. A new use case is one more entry in `USE_CASES`: the route, sitemap, footer and landing cards pick it up.

## Search Console and Bing (KRB-260)

Set up on 30 October 2026, with the v1.0.7 release.

| What | Where | Detail |
| --- | --- | --- |
| Google Search Console | search.google.com/search-console, owner: Mocktar's Google account | A **Domain** property for `kolabreport.com`, so it covers `www` and every page under `/fr`. |
| Verification | GoDaddy, **My Products > kolabreport.com > DNS** | A TXT record on `@` with the value `google-site-verification=...`. Never delete it: Google checks it again and drops the property when it is gone. |
| Sitemap | Search Console, **Sitemaps** | `https://kolabreport.com/sitemap.xml`. A Domain property needs the full address, not just `sitemap.xml`. |
| Bing Webmaster Tools | bing.com/webmasters | Imported from Search Console, which brings the verification. The import does not bring the sitemap of a Domain property: it was added by hand in **Sitemaps** with the full address. Bing read the 12 addresses on the first day. |

To give someone else access, use **Settings > Users and permissions** in Search Console. Give **Full** access, not Owner, unless they run the site.

What to look at, once a week the first month, then once a month:

- **Pages**: how many pages are indexed and why the others are not. All 12 sitemap pages should end up indexed. A signed-in page in the list means a `noindex` or the proxy is wrong.
- **Performance**: the searches that show the site and the ones that bring clicks. Compare them with the target searches above and update the table and the titles when they differ.
- **Sitemaps**: the status stays **Success**. "Couldn't fetch" on the first day is common; a red status after that is worth a look.

After adding or changing a public page, paste its address into **URL inspection** and click **Request indexing**. Google allows about ten requests a day.

## Directory listings (KRB-263)

Free listings, so buyers who look for a firm in a directory find KolabReport, and search engines see the same company in several places. Most directories mark their links `nofollow`, so they do little for ranking on their own.

The owner creates each account. Every listing links to `https://kolabreport.com/fr` and copies the name, address, phone and texts below word for word. Search engines compare listings, and a listing that differs from the others makes all of them less trusted.

### What every listing gets

| Field | Value |
| --- | --- |
| Company | Mocktar Technologies |
| Product | KolabReport |
| Address | C 1357 Houeyiho, 07BP91 Cotonou, République du Bénin |
| Phone | One business number, written the same way everywhere, starting with +229. None on file yet: the owner picks it. |
| E-mail | support@mocktar.com |
| Site | `https://kolabreport.com/fr` |
| Areas served | Bénin, Togo, Côte d'Ivoire |
| Logo | `public/icons/icon-512.png`, 512 by 512 |
| Cover image | `public/og/kolabreport.png`, 1200 by 630 |
| Photos | Screenshots from `public/guide/`, where a listing takes photos |

The name and address come from `src/content/legal/publisher.ts`, like the legal pages and the structured data. When they change there, update every live listing the same week.

Short text, 120 characters at most. It goes in the LinkedIn tagline and in any slogan or one-line field:

> Rapports d'audit, d'évaluation et d'étude rédigés en équipe, avec l'IA pour le premier jet.

Long text, 750 characters at most, Google's limit and the lowest of the lot:

> KolabReport est un logiciel en ligne pour rédiger en équipe des rapports d'audit, d'évaluation et d'étude. Le chef de mission découpe le rapport en sections et attribue chacune à un expert. Chaque expert dépose ses pièces (Word, Excel, CSV ou PDF), part d'un brouillon préparé par l'IA, le relit et valide son texte. Le chef de mission suit l'avancement de chaque section et exporte le rapport final en Word ou en PDF. KolabReport s'adresse aux cabinets d'audit et de conseil et aux bureaux d'études du Bénin, du Togo et de Côte d'Ivoire. Abonnement en FCFA, paiement par Mobile Money ou carte bancaire. Édité par Mocktar Technologies, à Cotonou.

The long text has no web address, no price and no trial offer: Google refuses a description with any of them. The site has the prices and the trial.

### The listings

In this order. The first two take a few minutes each.

| Listing | Where | How | Status |
| --- | --- | --- | --- |
| LinkedIn company page | linkedin.com, **For Business > Create a Company Page**, from the owner's own profile | Page name KolabReport, address `linkedin.com/company/kolabreport` if it is free, industry Software Development, the real company size, type Privately held. Tagline: the short text. **About**: the long text. The logo. | To do |
| Go Africa Online, Bénin | goafricaonline.com/bj, the free company sign-up | Company Mocktar Technologies, brand KolabReport, the closest software or IT category, then the fields and the long text above and the logo. Decline the paid packs: the free listing is enough. | To do |
| Google Business Profile | business.google.com | Only if Mocktar Technologies meets clients in person, for example to set up or train a team at their office. Google refuses online-only businesses and can suspend a profile that breaks this rule. If it qualifies: service-area business, address hidden, service areas around Cotonou (Google wants them within about two hours' drive), category Software company, verification by video. | Owner decides |
| Bing Places | bing.com/forbusiness | A new listing for Mocktar Technologies, software category, address hidden, the three countries as service areas. If the Google profile exists, import it instead of typing. Verify with whichever method Bing offers (phone, e-mail or post). If Benin is not in its country list, skip it. | To do |
| CCI Bénin | The chamber of commerce, by e-mail or at its office | No public member directory was found online. Ask whether it publishes one that lists software firms, and join it if it is free. | To ask |
| Go Africa Online, Togo and Côte d'Ivoire | goafricaonline.com/tg and /ci | Skipped. Each country site lists firms at an address in that country. We have none there, and a made-up address breaks the rule above. Add them when there is an office there. | Skipped |
| CCI Togo, CCI Côte d'Ivoire | | Skipped: the company is not registered in either country. | Skipped |

When a listing goes live, set its status to **Live** with the date, and open its link once to check it lands on `/fr`. When the phone, address or texts change, update every live listing.
