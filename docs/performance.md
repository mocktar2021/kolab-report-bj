# Performance

Lighthouse checks the sign-in page and the signed-in dashboard on master every Monday, when something was merged that week, and on a manual run of CI (KRB-153, KRB-190, KRB-220). This page covers the targets, how to run Lighthouse yourself, the CI job, the budgets, and what KRB-154, KRB-207 and KRB-172 changed.

## Targets

From story KRB-25, Lighthouse mobile on the production build:

| Category | Target | In CI |
| --- | --- | --- |
| Performance | 85 or more | error, fails the job (dashboard: 75 for now, see "Not fixed yet") |
| Accessibility | 95 or more | error, fails the job |
| Best practices | 95 or more | error, fails the job |
| JavaScript and total transfer | budgets below | warning only |

Each page runs 5 times, each time in a new Chrome, and the assertion uses the median score. With 3 runs, one slow run on a CI runner was enough to fail the job (KRB-210). Lighthouse 12 and later has no PWA category: installability is checked elsewhere.

"Mobile" is the Lighthouse default: Moto G Power screen, slow 4G and a 4x CPU slowdown. Throttling is simulated, so the score depends on the CPU of the machine that runs it. The report shows that machine's benchmark index under "CPU/Memory Power". Below about 1000, Lighthouse warns that the host is slow and the performance score drops.

## Run it locally

You need the local stack with its seed (the demo user `awa.dossou@kolabreport.test`), a production build and Playwright's Chromium:

```sh
npx supabase start
npm run build
npx playwright install chromium   # once
sh scripts/lighthouse-ci.sh
node scripts/lighthouse-summary.mjs
```

`scripts/lighthouse-ci.sh` starts `next start` on port 3000 and runs Lighthouse 5 times on the sign-in page. It then signs the demo user in once, in a Chrome profile (`scripts/lighthouse-profile.mjs`), and runs Lighthouse 5 times on the dashboard from that profile. Each run starts its own Chrome. The script checks the assertions, fails when a run ended on another page than the one asked for (the sign-in page, when the profile has no session), and writes the reports to `.lighthouseci/reports/` in any case. `scripts/lighthouse-summary.mjs` prints the score of every run and what cost the most on the median run. Open the `.report.html` files in a browser for the rest.

| You want to | Run |
| --- | --- |
| Use a server you already started, on another port | `LHCI_BASE_URL=http://localhost:3200 sh scripts/lighthouse-ci.sh` |
| Use another Chrome | `CHROME_PATH=/path/to/chrome sh scripts/lighthouse-ci.sh` |
| Sign in as another seeded user | `LHCI_EMAIL=... LHCI_PASSWORD=... sh scripts/lighthouse-ci.sh` |
| See what the long tasks of one load are made of | `node scripts/lighthouse-profile.mjs /tmp/lh-profile`, then `LHCI_PROFILE=/tmp/lh-profile node scripts/lighthouse-trace.mjs http://localhost:3000/fr/tableau-de-bord` |
| Look at one page by hand | Chrome DevTools > Lighthouse > Mobile, on `npm run start` |

Never measure `npm run dev`: it ships unminified code and React's development build, so the numbers mean nothing.

Keep the machine quiet while it runs. A build or a test suite running next to Lighthouse slows the page's main thread and the performance score can drop by 20 points. Total blocking time moves the most.

## In CI

The `Lighthouse` job in `.github/workflows/ci.yml` runs next to the end-to-end job and repeats its setup:

1. `npm ci`, then `npx supabase start`, which applies the migrations and `supabase/seed.sql`.
2. `scripts/ci-env-local.sh` writes `.env.local` from `supabase status`, the same file the end-to-end job uses.
3. `npm run build` with the `.next/cache` of the end-to-end job, and `npx playwright install --with-deps chromium`.
4. `sh scripts/lighthouse-ci.sh` with `lighthouserc.cjs`, then `scripts/lighthouse-summary.mjs` prints the score of every run in the job log.
5. The reports go up as the `lighthouse-reports` artifact (14 days), pass or fail.

To measure a branch before the merge, run CI by hand on it with **Lighthouse only** checked (**Actions > CI > Run workflow**). The checks and the end-to-end tests are skipped, so it takes about 7 minutes instead of 25, and a last step traces one dashboard load with `scripts/lighthouse-trace.mjs`. On `master` the option is ignored: every job runs.

It is its own job because both jobs need about the same setup (stack, build, Chromium). Run in parallel, Lighthouse adds no wall-clock time to CI. As the last step of the end-to-end job it would add about 3.5 minutes to every run (10 Lighthouse runs and the sign-in). It also measures a freshly seeded database, while the end-to-end tests leave their own workspaces and sections behind.

The reports never go to `temporary-public-storage`: that is a public URL, and the dashboard report shows workspace and section names. They stay in the run as an artifact.

### Why not the preview deployments

KRB-25 mentions previews. Vercel previews sit behind Vercel Authentication and use the staging database. Lighthouse would need a protection bypass secret, a staging account, and its scores would move with staging data and the Vercel region. CI runs Lighthouse on the same production build (`next build` and `next start`) against the local stack instead, so a drop points at the code of the pull request. To check a deployed page, use Chrome DevTools or PageSpeed Insights, and compare those numbers with each other, not with CI.

### When the job fails

1. Read the "Lighthouse scores" step of the job: the score of every run, the metrics of the median run, its costliest scripts and its long tasks. For more, download `lighthouse-reports` and open the HTML report of the failing page.
2. Look at the benchmark index first. A slow runner lowers performance for every page, so a score just under 85 with a low index can be the runner: run the job again once. A second failure is real.
3. For performance, start with "Largest Contentful Paint element" and "Avoid long main-thread tasks". For accessibility and best practices, the failing audits name the element.

## Budgets

Transfer sizes, warnings only, so a bigger page shows up in the run without blocking it. Values measured on the KRB-154 build with Lighthouse CI, plus about 15 %:

| Page | JavaScript (measured, budget) | All requests (measured, budget) |
| --- | --- | --- |
| `/fr/connexion` | 164 KiB, 190 KiB | 325 KiB, 375 KiB |
| `/fr/tableau-de-bord` | 288 KiB, 335 KiB | 499 KiB, 575 KiB |

The dashboard numbers include supabase-js, which loaded right after hydration for Realtime (about 70 KiB). Since KRB-172, Realtime alone is 17 KiB and the dashboard measures 274 KiB of JavaScript. The service worker fetches the page and its files a second time after load (see below), and the total counts that too.

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

## Next.js 16 (KRB-207)

Next.js 16 and React 19.3 add about 30 KB of compressed JavaScript to every page: the React DOM chunk grows from 55 to 65 KB and the Next.js runtime chunk from 51 to 72 KB. On a fast machine the sign-in page scores the same (median 95 on Next 15, 96 on Next 16). The first `master` run after the upgrade gave 92, 76, 80, 81 and 95, a median under the 85 target. With the CPU slowed 12 times instead of 4, closer to a CI runner, the sign-in page gave 82 on Next 15 and 80 on Next 16: it sits at the edge on a slow runner, and the upgrade pushed it under.

The "Mot de passe oublié ?" link of the sign-in form prefetched the reset page. Its JavaScript loaded and ran while the form hydrated, about 100 ms of main thread at 12 times. It now has `prefetch={false}`, like the landing links (item 3 above). Median of 3 runs each, CPU slowed 12 times, alternating between the two servers:

| Build | Performance | TBT | JavaScript |
| --- | --- | --- | --- |
| Next 16 | 84 | 544 ms | 199 KiB |
| Next 16, no prefetch of the reset page | 88 | 380 ms | 191 KiB |

The script budget of the sign-in page (190 KiB) stays a warning at 191 KiB. Before a framework upgrade, run CI by hand on its branch to see Lighthouse (`docs/ci.md`): pull requests do not run it.

## What KRB-172 changed

Measured on the CI runner with manual Lighthouse-only runs of CI, 5 runs per page.

1. **Realtime without supabase-js.** The dashboard and the master report loaded supabase-js after hydration only for Realtime: 240 kB minified, a task of about 375 ms (simulated), 325 ms of total blocking time. `src/lib/realtime/client.ts` now uses `@supabase/realtime-js` alone (57 kB) with the access token from `/api/realtime/token`. That route returns the token of the session cookie, after `getUser()` has checked it with Supabase Auth and refreshed it when it had expired. The dashboard's JavaScript went from 326 to 274 KiB. `src/lib/supabase/client.ts` is gone, so supabase-js no longer reaches the browser.
2. **Service worker after the load on a first visit.** Installing the worker downloads the whole precache, 143 files and 1.3 MB compressed. On a first visit it now registers 5 seconds after the load event instead of during hydration (`docs/pwa.md`).
3. **One Chrome per Lighthouse run.** Lighthouse CI shared one Chrome between all the runs of a page, because a puppeteerScript signed in. On the runner, every run then landed in the renderer process of the run before. Two runs out of three, the garbage collection of that old heap started when the next page committed: a task of 150 to 250 ms with no measured work in it, 600 to 1,000 ms once simulated, across first paint. Those runs scored 70 to 82, the others 87 to 96, and two runs of CI on the same commit gave medians of 75 and 89. Each run now starts its own Chrome, as Lighthouse does by default, and the dashboard runs start from a Chrome profile where the demo user is signed in. The old renderer also kept the scripts it had compiled, so the runs without that collection were a little fast: a new Chrome is a first visit.

| `/fr/tableau-de-bord` | CI runs | Medians | Single runs |
| --- | --- | --- | --- |
| Before | 3 | 79, 73, 79 | 66 to 89 |
| Item 1 | 1 | 82 | 75 to 96 |
| Items 1 and 2 | 3 | 75, 89, 74 | 69 to 92 |
| Items 1 and 2, one Chrome per run | 1 | 81 | 79 to 86 |

The sign-in page gives 90 to 95 with one Chrome per run (median 93), against 77 to 98 before.

Also tried and dropped: `experimental.inlineCss`. The HTML of the sign-in page grew from 10 to 56 KiB compressed, and LCP did not move. Lighthouse counts a script that ran before the observed first paint as needed for LCP. On a fast machine the async chunks of Next.js run before the first frame, so LCP sits around 3 s on both pages while first paint is at 1.1 to 1.2 s.

## Not fixed yet

The dashboard is still under the performance target: median 81 with one Chrome per run (single runs 79 to 86), against 85. `lighthouserc.cjs` fails it under 75 until the work below lands. About 120 ms less total blocking time would put the median over 85. What is left, largest first:

| Cost | Where | Way out |
| --- | --- | --- |
| Hydration of the client app shell. On the median run: a 258 ms task in the React DOM chunk, 117 ms in motion's chunk, 112 and 60 ms in the Next.js runtime (simulated) | `AppShell`, `Sidebar`, Radix dropdowns, motion's `LazyMotion` | Render the sidebar on the server with small client islands. Below `lg` the sidebar is hidden but still rendered and hydrated. |
| Server response, about 450 ms | the layout and the page each query Supabase several times (profile, workspaces, notifications, dashboard data, reports), after `getUser` in the proxy | Fewer round trips, or one RPC for the dashboard data. |
| A second fetch of the page and of every script and stylesheet after load | `cacheOnFrontEndNav` and `aggressiveFrontEndNavCaching` in `next.config.mjs` | The service worker fetches the current page again (a second server render on signed-in pages) and every `<script>` and `<link>` in it, including the `nomodule` polyfills (40 kB) that modern browsers never run. It runs in a worker, but it competes for the network during load. Owned by the PWA work, not changed here. |

Audits that stay red and do not count in the score:

- `bf-cache`: dynamic pages answer with `Cache-Control: no-store`.
- `legacy-javascript`: Next.js's own polyfill module (about 12 kB) in the framework chunk.
- `render-blocking-resources` and `unused-css-rules`: one Tailwind stylesheet for every page (14 kB compressed) and the font stylesheet.

## Rules for new code

- Content visible on first load never starts at opacity 0. Use `fade-in-50`, or move it with a transform only.
- A Client Component that calls `useTranslations` needs its namespace in the scope of its route (`src/i18n/client-messages.ts`). The unit test tells you which one.
- Load large client libraries when they are used: `next/dynamic`, `import()` or `LazyMotion`. cmdk, motion's layout features, the Realtime client, Sentry and the Tiptap editor of the section page (loaded when "Modifier le texte" is hovered, focused or clicked) already work this way.
- No supabase-js in the browser. Realtime goes through `src/lib/realtime/client.ts`, and data through Server Components, Server Actions and route handlers.
- Keep zod out of modules that Client Components import.
