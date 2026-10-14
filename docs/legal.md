# Legal pages

KolabReport publishes five legal pages in French (Jira KRB-159, part of the go-live checklist KRB-26). They are public, prerendered at build time and linked from the landing page footer, the sign-in pages and the app sidebar. This page says where the texts live, how to change them, and what a lawyer must review before the production launch.

The texts are drafts written from the facts we have: the publisher's registration, the business model of KRB-173 and the GDPR folder ([`docs/gdpr`](gdpr/README.md)). They are not legal advice.

| Route | Page | Source |
| --- | --- | --- |
| `/fr/mentions-legales` | Mentions légales: publisher, director of publication, contact, hosts, group company, intellectual property | `src/content/legal/mentions-legales.ts` |
| `/fr/confidentialite` | Politique de confidentialité: controller, roles, data, purposes and legal bases, recipients, subprocessors, transfers, retention, security, rights, APDP complaint, cookies, AI | `src/content/legal/confidentialite.ts` |
| `/fr/cgu` | Conditions générales d'utilisation: account, roles and invitations, acceptable use, content licence, AI drafts, availability, suspension, liability, end of use, changes, law and courts | `src/content/legal/cgu.ts` |
| `/fr/cgv` | Conditions générales de vente: seller, offers and prices, trial, order, FedaPay payment, prepaid periods, grace and read-only, Pass Mission, Pack IA, upgrades, refunds, invoices, Institution quotes, liability, law and courts | `src/content/legal/cgv.ts` |
| `/fr/accord-traitement-donnees` | Accord de traitement des données: roles, description of the processing, instructions, security, subprocessors, transfers, requests, breaches, end of contract, audits | `src/content/legal/accord-traitement-donnees.ts` |

## Where the texts live

The long texts are typed TypeScript modules in `src/content/legal/`, not entries of `messages/fr.json`. The project had no pattern for long legal text, and messages fit short UI strings: a legal page is about fifty paragraphs, lists and tables with links between pages. A module gives each section a typed shape, a stable anchor and a readable diff, and a unit test checks every link. The pages render on the server only, so the text adds no JavaScript and is not part of any client message scope.

| File | What it holds |
| --- | --- |
| `src/content/legal/publisher.ts` | Publisher facts shared by every page: name, form, address, RCCM, IFU, CNSS, e-mail, director, group company. Change them here only. |
| `src/content/legal/pages.ts` | The five routes. The middleware makes them public and the footers link to them. |
| `src/content/legal/<page>.ts` | One module per page: `updatedAt`, `intro` and `sections`. |
| `src/content/legal/cgv.ts` | Also `OFFERS`, the prices and limits of KRB-173. Billing must use the same numbers. |
| `src/content/legal/types.ts` | The block types: paragraph, list, label and value pairs, table. |
| `src/content/legal/rich-text.ts` | The inline syntax and its parser. |
| `src/components/legal/` | `LegalPage` (header, table of contents, date, sections, footer), `LegalBlocks` and `LegalLinks` (the row of links on the sign-in pages and in the app). |
| `messages/fr.json`, namespace `Legal` | Short UI strings only: page titles and meta descriptions, link labels, "Dernière mise à jour", "Sommaire". The app shell sends `Legal.nav` to the browser for the sidebar links. |
| `messages/fr.json`, key `Auth.legalConsent` | The acceptance line for the sign-up form, not wired yet (see below). |

Inline syntax inside every string:

| Write | For |
| --- | --- |
| `[politique de confidentialité](/confidentialite#cookies)` | A link to another page, path without `/fr` |
| `[Exercer vos droits](#exercer-vos-droits)` | A link to a section of the same page |
| `[apdp.bj](https://apdp.bj)`, `[support@mocktar.com](mailto:support@mocktar.com)` | An external link or an e-mail address |
| `**Compte**` | Bold |
| `` `kr-espace` `` | Code, for cookie names |

No other link is allowed: `src/content/legal/documents.test.ts` fails on an `http://` link, on a page that is not a legal page and on an anchor that does not exist.

## How to update a text

1. Edit the module of the page. Keep each section `id`: it is the anchor that other pages, e-mails and contracts link to. Add a section with a new id rather than renaming one.
2. Set `updatedAt` of that page to the day of the change, as `YYYY-MM-DD`. Only the pages you changed get a new date.
3. If the change is important, tell the users before it applies. The texts promise it:
   - CGU: 30 days before, by e-mail or in the app (`/fr/cgu#modifications`).
   - CGV: 30 days before a price change, to the owners. A paid period never changes.
   - Data processing agreement: 30 days before a new subprocessor receives workspace content, with a right to object.
   - Privacy policy: before an important change applies.
4. Keep [`docs/gdpr`](gdpr/README.md) in the same pull request. The privacy policy follows `processors.md`, `retention.md` and `record-of-processing.md`. A new subprocessor goes in `processors.md` and in the table of `confidentialite.ts` before it receives data.
5. Run the checks:

```bash
npx vitest run src/content/legal
python3 .claude/skills/write-like-mocktar/scripts/check_prose.py src/content/legal/*.ts docs/legal.md
npm run build && PORT=3800 npm run start   # in another terminal
E2E_BASE_URL=http://localhost:3800 npx playwright test tests/e2e/legal.spec.ts
```

What else to update when something changes:

| When this changes | Update |
| --- | --- |
| Publisher details, contact, director | `publisher.ts`, then `docs/gdpr/record-of-processing.md` |
| A provider, a region, the AI or e-mail provider | `confidentialite.ts` (subprocessors, transfers) and `docs/gdpr/processors.md` |
| A retention period or a cleanup job | `confidentialite.ts` (conservation), `accord-traitement-donnees.ts` (fin du contrat) and `docs/gdpr/retention.md` |
| A cookie or a `localStorage` key | `confidentialite.ts` (cookies) |
| What the AI receives or masks | `confidentialite.ts` (intelligence artificielle) and `docs/gdpr/record-of-processing.md` |
| A price, a limit, the grace period | `OFFERS` in `cgv.ts`, and billing (KRB-173) |
| A security measure | `confidentialite.ts` (sécurité) and `accord-traitement-donnees.ts` (mesures de sécurité) |

## Sign-up acceptance line

`Auth.legalConsent` holds the line for the sign-up form: "En créant un compte, vous acceptez les CGU, les CGV et la politique de confidentialité", with three tags for the links. It is not shown yet: the sign-up form and its server action are being changed for the CAPTCHA in another story, so this story leaves them alone. To wire it under the submit button of `src/app/[locale]/inscription/sign-up-form.tsx`, which already reads the `Auth` namespace:

```tsx
<p className="text-xs text-muted-foreground">
  {t.rich("legalConsent", {
    cgu: (chunks) => <Link href="/cgu" prefetch={false} className="underline underline-offset-4">{chunks}</Link>,
    cgv: (chunks) => <Link href="/cgv" prefetch={false} className="underline underline-offset-4">{chunks}</Link>,
    privacy: (chunks) => <Link href="/confidentialite" prefetch={false} className="underline underline-offset-4">{chunks}</Link>,
  })}
</p>
```

The lawyer may also ask to record the acceptance: which version (`updatedAt`) of each text a person accepted, and when.

## Lawyer review before launch

Each point below is either a fact we could not confirm or a rule we chose. The pages state a general rule where the fact is unknown.

Publisher and legal notice:

- [ ] Legal form. The pages say "Établissement". Confirm the exact wording, and whether the name of the person who runs the établissement must appear as operator.
- [ ] Whether the legal notice needs a phone number. None is given.
- [ ] Hosts. The pages name Vercel Inc. and Supabase Inc. with links to their sites, without postal address or phone: the docs give none. Confirm the legal names and whether the addresses are required.
- [ ] The pages say the name KolabReport and its logo belong to Mocktar Technologies, not that it is a registered trademark. Check an OAPI filing before saying more.
- [ ] Mocktar Technologies LLC (United States) supports engineering. If its people can reach production data, it is a recipient and a subprocessor outside the EU and Benin, and must be listed with its transfer safeguards. The pages do not list it today.

Data protection:

- [ ] Controller and processor roles. `docs/gdpr/README.md` marks them as assumptions. The privacy policy and the data processing agreement rely on them.
- [ ] APDP formalities under the code du numérique (loi n° 2017-20 du 20 avril 2018): declaration or authorization of the processing before launch, authorization of transfers outside Benin (hosting in the EU is one), whether a data protection officer is needed. The pages cite no article number of the code.
- [ ] GDPR for users in the EU: whether an EU representative is needed, and a DPIA for the AI processing of report content.
- [ ] The legal bases in the privacy policy, taken from the proposals of `record-of-processing.md`.
- [ ] The privacy policy says Mocktar Technologies only uses processors bound by a data processing agreement. Every DPA in `docs/gdpr/processors.md` is still "to sign / to confirm". Sign them before launch, or change the sentence.
- [ ] The subprocessor list. Choose Resend or Brevo (the page names both), confirm whether OpenAI is used as fallback, and remove the optional services that will not run in production (Sentry, Langfuse, Cloudflare R2, GitHub backups) or keep them with "lorsqu'il est activé".
- [ ] FedaPay is not built yet (KRB-173). Confirm its role (own controller or processor), its location, what it sends back (the page says reference, amount, date, status and payment method), and that no card number or mobile money code reaches our servers, as the privacy policy and the CGV say.
- [ ] AI provider terms: how long it keeps API inputs and outputs, whether it trains on them, where it processes them, zero data retention. The page uses a neutral sentence until this is confirmed.
- [ ] Transfer safeguards per provider (standard contractual clauses, Data Privacy Framework), and Supabase's access from outside the EU.
- [ ] Retention periods still "to decide" in `docs/gdpr/retention.md`, written on the page as general rules: sign-in journal, support messages, billing records (accounting and tax period), accounts never confirmed or inactive, invitations, notifications, AI draft text after its section is deleted.
- [ ] Response time to requests: the page promises one month, extendable by two (the GDPR rule). Check the delay under Benin law.
- [ ] Cookies: the page says the cookies are strictly necessary and need no prior consent. Confirm under Benin law.
- [ ] Security claims that depend on production settings: e-mail confirmation on the hosted Supabase projects, and the nightly encrypted database dump and EU file copy, which only run once their secrets are set (`docs/operations/backups.md`). The privacy policy and the agreement state both. Check they run before launch, or remove the sentences.
- [ ] Breaches: the privacy policy promises to notify the authority and, where the law requires, the people concerned. Write the breach procedure (open action in `docs/gdpr/README.md`) and check the Benin deadlines.

CGU:

- [ ] Liability exclusions and the carve-out for "faute lourde ou intentionnelle" under Benin and OHADA law.
- [ ] Users must be adults acting for their work.
- [ ] 30 days notice for an important change, and acceptance by continued use.
- [ ] The licence on user content, and the promise not to train AI models on it.
- [ ] The amicable step (30 days) before the courts of Cotonou. Say whether a specific court, such as the commercial court, should be named.

CGV:

- [ ] Refund policy: no refund for a started period, a started Pass Mission or a bought Pack IA. Exceptions: double payment, termination for our serious breach (unused part refunded), objection to a new subprocessor, cases where the law requires a refund. Refund within 30 days.
- [ ] No withdrawal right, because the offers are for professionals only.
- [ ] Liability cap: the amount before tax paid in the 12 months before the event, except gross or intentional fault. For a trial it comes to zero: check it holds.
- [ ] Tax wording: prices before tax, "taxes applicables selon la réglementation en vigueur", no rate or regime stated. The VAT treatment and the normalized invoice are being checked with an accountant. Then update the invoices section, which only says "une facture conforme à la réglementation en vigueur".
- [ ] Rules we chose, to confirm with the product owner:
  - an active report is one that is not final;
  - every AI draft produced counts, accepted or not;
  - the monthly AI quota restarts each month, with no carry-over;
  - one free trial per organization;
  - at the end of the trial the workspace goes read-only, with no grace period;
  - a quarter costs three months;
  - a period paid early starts at the end of the current one, and a period paid during the grace period starts at the end of the previous one;
  - Pack IA drafts stay usable while a paid offer is active;
  - an upgrade is paid pro rata for the days left, a downgrade starts at the next period;
  - owners are warned 30 days before the data of a read-only workspace is deleted;
  - 15 days to fix a serious breach after a formal notice;
  - force majeure longer than 30 days lets either party end the contract.
- [ ] The order flow: the CGV say the client orders from KolabReport or by e-mail. Billing is not built (KRB-173). Adjust who can order (owners only?) and how once it ships.
- [ ] Receipts and invoices go by e-mail to the address given with the order.
- [ ] Institution quotes: validity, optional service level, payment by transfer.

Data processing agreement:

- [ ] How it is accepted: the text says it applies as soon as the client accepts the CGU or orders. Check that this is enough, or have Institution clients sign it.
- [ ] Breach notice to the client within 48 hours.
- [ ] 30 days notice for a new subprocessor, objection right, refund of the unused part if the client leaves.
- [ ] Deletion within 30 days of a written request, then backups expire after 14 days (database) and about 32 days (files).
- [ ] One audit a year at the client's cost, 30 days notice.
- [ ] Article 28 of the GDPR is the only article number cited in the texts.

Out of scope here: the app has no `sitemap.xml` or `robots.txt` yet, so the pages are not listed in one. Add them when the SEO work happens.
