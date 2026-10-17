# Performance

Lighthouse checks the sign-in page and the signed-in dashboard on every push to master and on a manual run of CI (KRB-153, KRB-190). This page covers the targets, how to run Lighthouse yourself, the CI job, the budgets, and what KRB-154 changed to get there.

## Targets

From story KRB-25, Lighthouse mobile on the production build:

| Category | Target | In CI |
| --- | --- | --- |
| Performance | 85 or more | error, fails the job (dashboard: 65 until KRB-172) |
| Accessibility | 95 or more | error, fails the job |
| Best practices | 95 or more | error, fails the job |
| JavaScript and total transfer | budgets below | warning only |

Each page runs 5 times and the assertion uses the median score. With 3 runs, one slow run on a CI runner was enough to fail the job (KRB-210). Lighthouse 12 and later has no PWA category: installability is checked elsewhere.

"Mobile" is the Lighthouse default: Moto G Power screen, slow 4G and a 4x CPU slowdown. Throttling is simulated, so the score depends on the CPU of the machine that runs it. The report shows that machine's benchmark index under "CPU/Memory Power". Below about 1000, Lighthouse warns that the host is slow and the performance score drops.

## Run it locally

You need the local stack with its seed (the demo user `awa.dossou@kolabreport.test`), a production build and Playwright's Chromium:

```sh
npx supabase start
npm run build
npx playwright install chromium   # once
npx lhci autorun
```

`lhci autorun` starts `npm run start` on port 3000, signs in through `scripts/lighthouse-login.cjs`, runs Lighthouse 5 times per page, checks the assertions and writes the reports to `.lighthouseci/reports/`. Open the `.report.html` files in a browser.

| You want to | Run |
| --- | --- |
| Use a server you already started, on another port | `LHCI_BASE_URL=http://localhost:3200 npx lhci autorun` |
| Use another Chrome | `CHROME_PATH=/path/to/chrome npx lhci autorun` |
| Sign in as another seeded user | `LHCI_EMAIL=... LHCI_PASSWORD=... npx lhci autorun` |
| Look at one page by hand | Chrome DevTools > Lighthouse > Mobile, on `npm run start` |

Never measure `npm run dev`: it ships unminified code and React's development build, so the numbers mean nothing.

Keep the machine quiet while it runs. A build or a test suite running next to Lighthouse slows the page's main thread and the performance score can drop by 20 points. Total blocking time moves the most.

## In CI

The `Lighthouse` job in `.github/workflows/ci.yml` runs next to the end-to-end job and repeats its setup:

1. `npm ci`, then `npx supabase start`, which applies the migrations and `supabase/seed.sql`.
2. `scripts/ci-env-local.sh` writes `.env.local` from `supabase status`, the same file the end-to-end job uses.
3. `npm run build` with the `.next/cache` of the end-to-end job, and `npx playwright install --with-deps chromium`.
4. `npx lhci autorun` with `lighthouserc.cjs`.
5. The reports go up as the `lighthouse-reports` artifact (14 days), pass or fail.

It is its own job because both jobs need about the same setup (stack, build, Chromium). Run in parallel, Lighthouse adds no wall-clock time to CI. As the last step of the end-to-end job it would add about 3.5 minutes to every run (10 Lighthouse runs and the sign-in). It also measures a freshly seeded database, while the end-to-end tests leave their own workspaces and sections behind.

The reports never go to `temporary-public-storage`: that is a public URL, and the dashboard report shows workspace and section names. They stay in the run as an artifact.

### Why not the preview deployments

KRB-25 mentions previews. Vercel previews sit behind Vercel Authentication and use the staging database. Lighthouse would need a protection bypass secret, a staging account, and its scores would move with staging data and the Vercel region. CI runs Lighthouse on the same production build (`next build` and `next start`) against the local stack instead, so a drop points at the code of the pull request. To check a deployed page, use Chrome DevTools or PageSpeed Insights, and compare those numbers with each other, not with CI.

### When the job fails

1. Download `lighthouse-reports` from the run and open the HTML report of the failing page.
2. Look at the benchmark index first. A slow runner lowers performance for every page, so a score just under 85 with a low index can be the runner: run the job again once. A second failure is real.
3. For performance, start with "Largest Contentful Paint element" and "Avoid long main-thread tasks". For accessibility and best practices, the failing audits name the element.

## Budgets

Transfer sizes, warnings only, so a bigger page shows up in the run without blocking it. Values measured on the KRB-154 build with Lighthouse CI, plus about 15 %:

| Page | JavaScript (measured, budget) | All requests (measured, budget) |
| --- | --- | --- |
| `/fr/connexion` | 164 KiB, 190 KiB | 325 KiB, 375 KiB |
| `/fr/tableau-de-bord` | 288 KiB, 335 KiB | 499 KiB, 575 KiB |

The dashboard numbers include supabase-js, which loads right after hydration for Realtime (about 70 KiB). The service worker fetches the page and its files a second time after load (see below), and the total counts that too.

Change a budget in `lighthouserc.cjs` when a page grows on purpose, and say why in the commit.

## What KRB-154 changed

Measured with Lighthouse 13.5 mobile on `next start`, the master build against this branch. The runs alternate between the two servers so both see the same machine load, which was high (other builds and test suites ran on the same 4 cores, benchmark index 1130 to 1540). Median of 4 to 5 runs.

| Page | Build | Performance | LCP | TBT | JavaScript | Total |
| --- | --- | --- | --- | --- | --- | --- |
| `/fr/connexion` | before | 64 | 4.5 s | 990 ms | 280 KiB | 523 KiB |
| `/fr/connexion` | after | 91 | 2.4 s | 290 ms | 164 KiB | 325 KiB |
| `/fr/tableau-de-bord` | before | 54 | 4.8 s | 2,150 ms | 332 KiB | 573 KiB |
| `/fr/tableau-de-bord` | after | 67 | 3.2 s | 1,760 ms | 288 KiB | 499 KiB |

An earlier series on a quieter machine gave 72 to 93 on the sign-in page and 55 to 68 on the dashboard. Lighthouse CI on the final build gave 91 and 71. Accessibility and best practices were 100 on both pages, before and after. Total blocking time on the dashboard moves by several hundred milliseconds from one run to the next on this machine, more than this work changed it.

1. **Messages per page.** `<NextIntlClientProvider>` had no `messages` prop, so every page carried all of `messages/fr.json` (about 70 kB) in its RSC payload: 78 kB of the 88 kB sign-in HTML. Layouts now send a scope from `src/i18n/client-messages.ts` with only the namespaces their Client Components read. The sign-in HTML is 27 kB. `src/i18n/client-messages.test.ts` follows the imports of every route and fails when a Client Component reads a namespace its scope does not send.
2. **Fades from half opacity.** The sign-in card and every signed-in page faded in from opacity 0. Chrome does not count a transparent element as largest contentful paint, so the card only counted at the first frame painted after hydration, 0.7 to 0.9 s after first paint. Lighthouse's simulation then puts all the JavaScript of the page before LCP. The fades now start at 50 % (`fade-in-50`), and LCP lands on first paint. The landing hero got the same fix.
3. **No landing prefetch from the auth pages.** The logo and back links prefetched the landing page. Its JavaScript (motion, and the app shell chunks that Next.js lists for the landing route) then ran while the sign-in form hydrated: about 0.5 s of simulated main thread.
4. **Dashboard figures in CSS.** The KPI cards used motion's stagger: transparent until hydration, then JavaScript on every frame. They now rise with a CSS animation from first paint.
5. **Command palette on demand.** cmdk and the palette load the first time Cmd+K or the search button opens it.
6. **Motion layout features on demand, desktop only.** The sliding nav highlight was the only full motion import on signed-in pages. With `LazyMotion` and `m` components the shell ships about 8 kB of motion instead of 46 kB (compressed), and the layout features load after hydration from the `lg` breakpoint. On phones the nav sits in the menu sheet, which closes on navigation, so the highlight never slides there.
7. **No zod in the browser.** `roles.ts` and `sections.ts` pulled zod (13 kB compressed) into every signed-in page through the sidebar and the nav, and `src/lib/env.ts` pulled it in again next to supabase-js. The schemas moved out of what Client Components import, and the browser Supabase client reads its two inlined variables directly.

Checked and left as they were: `MotionProvider` and `ThemeProvider` in the root layout cost about 2.5 kB compressed together, the two `next/font` fonts are self-hosted and preloaded, lucide-react imports are already per icon (Next.js optimizes the package by default), and Sentry stays out of the bundle until `NEXT_PUBLIC_SENTRY_DSN` is set.

## Not fixed yet

The dashboard is still under the performance target: 67 to 71 here, against 85. Until the work below lands (KRB-172), `lighthouserc.cjs` fails the dashboard under 65 instead of 85, so the job stays green and still catches a regression. What is left, largest first:

| Cost | Where | Way out |
| --- | --- | --- |
| supabase-js, 240 kB minified, one long task of 0.5 to 1.2 s (simulated) right after hydration | `useLiveSections` for Realtime, dashboard and master report | Subscribe with `@supabase/realtime-js` alone (58 kB) and an access token from the session, or start Realtime later. Starting it on the first idle moment after load did not help: Lighthouse still records it. |
| Hydration of the client app shell, about 1 s (simulated) | `AppShell`, `Sidebar`, Radix dropdowns (96 kB minified) | Render the sidebar on the server with small client islands. Below `lg` the sidebar is hidden but still rendered and hydrated. |
| Server response, about 450 ms | the layout and the page each query Supabase several times (profile, workspaces, notifications, dashboard data, reports), after `getUser` in the proxy | Fewer round trips, or one RPC for the dashboard data. |
| A second fetch of the page and of every script and stylesheet after load | `cacheOnFrontEndNav` and `aggressiveFrontEndNavCaching` in `next.config.mjs` | The service worker fetches the current page again (a second server render on signed-in pages) and every `<script>` and `<link>` in it, including the `nomodule` polyfills (40 kB) that modern browsers never run. It runs in a worker, but it competes for the network during load. Owned by the PWA work, not changed here. |

Audits that stay red and do not count in the score:

- `bf-cache`: dynamic pages answer with `Cache-Control: no-store`.
- `legacy-javascript`: Next.js's own polyfill module (about 12 kB) in the framework chunk.
- `render-blocking-resources` and `unused-css-rules`: one Tailwind stylesheet for every page (14 kB compressed) and the font stylesheet.

## Rules for new code

- Content visible on first load never starts at opacity 0. Use `fade-in-50`, or move it with a transform only.
- A Client Component that calls `useTranslations` needs its namespace in the scope of its route (`src/i18n/client-messages.ts`). The unit test tells you which one.
- Load large client libraries when they are used: `next/dynamic`, `import()` or `LazyMotion`. cmdk, motion's layout features, supabase-js, Sentry and the Tiptap editor of the section page (loaded when "Modifier le texte" is hovered, focused or clicked) already work this way.
- Keep zod out of modules that Client Components import.
