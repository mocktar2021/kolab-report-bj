# PWA: updates and installability

KolabReport ships a service worker built by `@ducanh2912/next-pwa` (Workbox). The options live in the `withPWAInit` block of `next.config.mjs`. The worker is off in `npm run dev`.

## How an update reaches users (KRB-156)

Each build writes a new `public/sw.js`: its precache list holds the build id and the new chunk hashes. `/sw.js` is served with `Cache-Control: no-cache, no-store`, so browsers always compare against the deployed file.

1. `UpdateBanner` (`src/components/pwa/update-banner.tsx`) is mounted in the locale layout and registers the worker (`register: false` in the config, so it listens before the first event).
2. The browser checks for a new `sw.js` on every full page load. An open tab also checks every hour, and when it comes back into view (at most once a minute).
3. A new worker installs in the background, then waits (`skipWaiting: false`). Open tabs keep running the code they loaded.
4. Every open tab shows "Nouvelle version disponible" with two buttons, "Mettre à jour" and "Plus tard". The banner is a `role="status"` region, reachable with Tab, and it never takes the focus.
5. "Mettre à jour" sends `SKIP_WAITING` to the waiting worker. It activates and takes over the open tabs (`clientsClaim: true`). The tab where the user clicked reloads once, on `controllerchange`. If the takeover has not happened after 10 seconds, it reloads anyway.
6. If the page holds unsaved work, "Mettre à jour" only asks the user to save first. Unsaved work is what registers `useUnsavedWork` (`src/lib/unsaved-work.ts`): the section text being edited and deliverables being sent. Use the same hook for any new editor.
7. The other open tabs never reload by themselves, because they may hold text. They now run under the new worker but keep their page and their banner. "Mettre à jour" there only reloads.
8. "Plus tard" hides the banner in that tab until a newer version arrives. The next page load shows it again, since the worker still waits. When the user closes every tab, the waiting worker takes over and the next visit starts on the new version.

The app no longer reloads every page when the network comes back (`reloadOnOnline: false`): that reload could throw away a section being edited. Only the offline page `/fr/hors-ligne` reloads itself (`ReloadWhenOnline`).

### Users who still run the old worker

Before this change the worker called `skipWaiting()` on install and took over open tabs at once. The first deploy with this change is the last silent one:

- The new `sw.js` no longer calls `skipWaiting()`, so it installs and waits behind the old worker.
- A tab opened before the deploy has the old code: no banner, and it still reloads on reconnect. Nothing breaks, and the old code goes away when the tab is reloaded or closed.
- A page loaded after the deploy runs the new code under the old worker, finds the waiting worker and shows the banner. One click moves the user to the new flow.
- A user who closes every tab gets the new worker on the next visit without seeing the banner.

No step by hand and no cache clearing.

## Test the update flow by hand

1. `npm run build`, then `npx next start -p 3400`.
2. Open http://localhost:3400/fr in Chrome. In DevTools > Application > Service workers, wait for `sw.js` to show as activated. Leave "Update on reload" unchecked: it skips the waiting step.
3. Stop the server, run `npm run build` again and start it again. A new build is enough to change `sw.js`.
4. In the open tab, click "Update" in DevTools > Application > Service workers, or run `(await navigator.serviceWorker.getRegistration()).update()` in the console. Switching to another tab and back also works after a minute.
5. The banner shows and DevTools lists the new worker as "waiting to activate".
6. To check unsaved work, sign in, open a section, click "Modifier" and type a few words. "Mettre à jour" then asks you to save first, and the page stays.
7. With nothing unsaved, "Mettre à jour" reloads the page once and DevTools shows the new worker as activated.

## Installability test (KRB-25)

Lighthouse 12 removed its PWA category. `tests/e2e/pwa.spec.ts` runs the same checks with Chrome itself, on a production build of `/fr`:

- `Page.getInstallabilityErrors` over the Chrome DevTools Protocol returns no error. This is what the Lighthouse "Installable" audit read. `Page.getAppManifest` reports no parse error either.
- The manifest has `name`, `short_name`, `display: standalone`, theme and background colours, a `start_url` inside `scope`, and icons 192 and 512 with purpose `any` plus a 512 `maskable` one. Each icon is served as `image/png` at the size it claims.
- A service worker controls `/fr` after a reload.
- The update flow, with two tabs: the banner shows, the new worker waits, "Mettre à jour" reloads the tab once under the new worker, and the other tab keeps its page until its user reloads.
- When the network comes back, the offline page reloads and the landing page does not.

Run it on a production build:

```bash
npm run build
npx next start -p 3400
E2E_BASE_URL=http://localhost:3400 npx playwright test tests/e2e/pwa.spec.ts
```

CI runs it with the rest of the e2e suite.

Playwright's `page.route` and `context.route` do not see the browser's own fetch of `/sw.js` during an update check. The update test therefore starts a small proxy in front of the app. After `nextDeploy()`, the proxy adds a few lines to `/sw.js`, the way a deploy changes the file. Those lines answer a message, so the test can tell which worker controls the page.
