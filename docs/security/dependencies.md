# Dependency advisories

This page lists what `npm audit --omit=dev` reports for the production dependencies, what was done about each high or critical advisory, and what is left on purpose and why. CI runs `node scripts/audit-production.mjs` (see `docs/ci.md`). It fails on any high or critical advisory that `.github/accepted-advisories.json` does not accept, and this page is the review behind that list.

Last review: 2026-10-14, Jira KRB-164.

## Before and after KRB-164

Before: 30 flagged packages (9 high, 16 moderate, 5 low) from 5 high advisories. After: 12 flagged packages (4 high, 8 moderate). The 4 high packages all come from one advisory, accepted below.

| Advisory | Severity | Package | Came through | Done |
| --- | --- | --- | --- | --- |
| GHSA-j4fx-xxwh-2485 | high | jsondiffpatch | `ai` 4 | Upgraded to AI SDK 6 (`ai` 6.0.306), which no longer depends on it |
| GHSA-33vc-wfww-vjfv | moderate | jsondiffpatch | `ai` 4 | Same upgrade |
| GHSA-866g-f22w-33x8 | low | @ai-sdk/provider-utils | `ai` 4, `@ai-sdk/openai` 1, `@ai-sdk/anthropic` 1 | Same upgrade, providers at 3.x |
| GHSA-rwvc-j5jr-mgvh | low | ai | direct | Same upgrade |
| GHSA-6g55-p6wh-862q | high | postcss 8.4.31 | `next` 15.5.27 | Override `next` > `postcss` `^8.5.23` |
| GHSA-r28c-9q8g-f849 | high | postcss 8.4.31 | `next` 15.5.27 | Same override |
| GHSA-qx2v-qp2m-jg93, GHSA-fxqj-rqcc-2cmp | moderate | postcss 8.4.31 | `next` 15.5.27 | Same override |
| GHSA-5c6j-r48x-rmvq | high | serialize-javascript 6.0.2 | `@ducanh2912/next-pwa` > `workbox-build` 7.1 > `@rollup/plugin-terser` 0.4.4 | Override `@rollup/plugin-terser` `^1.0.0` (serialize-javascript 7.1.2) |
| GHSA-qj8w-gfj5-8c6v | moderate | serialize-javascript 6.0.2 | same path | Same override |
| GHSA-vfj7-8cjw-p6xm | high | braces 3.0.3 | `@ducanh2912/next-pwa` > `fast-glob` > `micromatch`, and `tailwindcss` through `tailwindcss-animate` | `tailwindcss-animate` moved to devDependencies. The next-pwa path is accepted, see below |
| GHSA-rj75-hqrm-r3gf | moderate | postcss-selector-parser | `tailwindcss` through `tailwindcss-animate` | Gone from the production tree with the same move |

`tailwindcss-animate` is only imported by `tailwind.config.ts`, at build time, like `tailwindcss`, which was already a dev dependency. Vercel and every CI job install dev dependencies before `next build`, so the build is unchanged.

## Accepted: GHSA-vfj7-8cjw-p6xm (braces)

- The advisory: braces up to 3.0.3 overflows the stack on deeply nested brace patterns and crashes the Node process. 3.0.3 is the latest release and there is no patched version. Every `micromatch` and every `fast-glob` version depends on it, so no override can remove it.
- The path: `@ducanh2912/next-pwa` 10.2.9 > `fast-glob` 3.3.2 > `micromatch` 4.0.8 > `braces` 3.0.3.
- Why it does not apply: next-pwa calls `fast-glob` only inside its `webpack()` hook, so only during `next build`. It lists the files in `public/` for the precache manifest, looks for a custom worker, and removes old `workbox-*.js` files. The patterns are written in next-pwa and in the `withPWAInit` block of `next.config.mjs`. No request, upload or other user input ever reaches a glob pattern.
- At runtime: the Vercel server functions are traced from the routes and do not include next-pwa. The browser gets `sw.js` and `workbox-*.js`, built from the Workbox runtime packages, which do not use braces.
- Worst case: a bad pattern in our own config crashes `next build`, which CI catches.
- Review again by 2027-01-14 (the `expires` date in the list), or earlier when braces ships a fix or next-pwa is replaced by Serwist.

## Accepted: GHSA-mrhx-c7xc-m3w5 (zod)

- The advisory (2026-10-23, high, CWE-770): zod before 4.6.6 can exhaust memory while validating oversized constrained collections. Every zod 3 release is affected. The fix is zod 4, a major upgrade.
- The path: `zod` 3.25.76 is a direct dependency, used on the server for every form, server action, route handler body, AI output and database row the app checks.
- What happens: on `z.array(item).max(n)`, zod 3 notes that the list is too long, then still checks every item and builds one error for each bad one. Measured on zod 3.25.76: a list of one million one-character strings, which fits in the 2 MB limit of a server action body, gave 1,000,001 errors and 284 MB of heap in 1.2 s. A few such requests at once could take a server function down.
- Where outside input reaches a zod collection: only two server actions take an array from the browser, `reorderSections` (500 sections at most) and `markNotificationsRead` (100 ids at most). Since KRB-240 both refuse a longer list before zod runs, with tests that fail if an item is read. Forms send strings. Route handlers parse fixed objects. The FedaPay webhook checks its signature before it parses the body. Arrays from the database and from the AI model are bounded by our own queries and by the output token caps.
- Why not upgrade now: zod 4 changes the JSON schemas sent to the AI model, so the upgrade runs the paid eval gate, and it touches 54 files three days before the launch. It is KRB-241.
- Review again by 2026-11-30 (the `expires` date in the list), or as soon as KRB-241 is merged: then remove the entry and this section.

## Overrides in package.json

| Override | Why | Remove when |
| --- | --- | --- |
| `"@rollup/plugin-terser": "^1.0.0"` | workbox-build 7.1 asks for `^0.4.3`. Version 1.0.0 ships the same code as 0.4.4 and only moves to `serialize-javascript` 7 and Node 20. The built `sw.js` keeps the same routes and caching, and `workbox-*.js` is identical. | next-pwa depends on workbox-build 7.4.1 or later, or we move to Serwist |
| `"next": { "postcss": "^8.5.23" }` | next 15.5.27 and 15.5.28 pin postcss 8.4.31. Next 16 ships 8.5.23, so the same 8.5 line works with Next's CSS pipeline. | `next` depends on postcss 8.5.23 or later |

After a Dependabot bump of `next` or `@ducanh2912/next-pwa`, check `npm ls postcss serialize-javascript`: it should show only postcss 8.5.x and serialize-javascript 7.x. When npm adds an override to an existing lockfile it can keep the old nested copy and `npm ls` marks it "invalid". Delete that entry (for example `node_modules/next/node_modules/postcss`) from `package-lock.json` and run `npm install` again.

## Moderate advisories left

These don't block CI. Each one needs a breaking upgrade of a direct dependency, so they are left for separate stories.

| Advisory | Package | Came through | Fix |
| --- | --- | --- | --- |
| GHSA-8988-4f7v-96qf | @opentelemetry/core < 2.8.0 | `@opentelemetry/sdk-logs` 0.208 | `@opentelemetry/sdk-logs` 0.223 or later |
| GHSA-hp3w-g68c-fv3c | sprintf-js | `mammoth` > `argparse` 1 | A mammoth release without argparse 1 |
| GHSA-w5hq-g745-h8pq | uuid < 11.1.1 | `exceljs` 4 | An exceljs release on uuid 11, or an override after checking exceljs |

## Reviewing a new advisory

1. Run `npm audit --omit=dev` and `npm explain <package>` to find the path.
2. Prefer an upgrade. Then an `overrides` entry to a patched version in the same major, checked with `npm run build`, and with a look at `public/sw.js` when Workbox is involved.
3. When there is no fix and the code only runs at build time or never sees outside input, add an entry to `.github/accepted-advisories.json`: the GHSA id, the direct dependencies in `via`, the reason, the review date and an `expires` date at most three months later. Add a section on this page with the path and the reasoning.
