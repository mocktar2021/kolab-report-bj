# Account deletion and data export

Security notes for `/fr/compte` (KRB-186), where a signed-in person downloads their data, transfers an organization they own and deletes their account. The rules themselves are in [`docs/gdpr/data-subject-requests.md`](../gdpr/data-subject-requests.md#self-service-in-the-app).

## What stops what

| Risk | What stops it |
| --- | --- |
| Acting on someone else's account | Every server action and `GET /api/account/export` take the user from `getUser()` on the session. Nothing in the form, the URL or the body says whose account it is. `prepare_account_deletion(user_id)` is granted to the service role only, and the server passes the session's id. |
| A stolen session deletes the account | The person types the account's e-mail address and their current password. The server checks the password with its own sign-in, on a client that keeps the session in memory and ends it right away (`src/lib/account/password.ts`), so the browser's session cookie is untouched. |
| Guessing a password through the form | `claim_account_deletion()` allows 5 tries in 15 minutes per person, whatever their outcome, on top of Supabase Auth's sign-in rate limit. The Turnstile token goes to Supabase when captcha is on. |
| A double click or two tabs | One deletion runs at a time per person: `claim_account_deletion()` takes an advisory lock and refuses while a try started less than 2 minutes ago has not ended. The submit button is disabled while the request runs. |
| A workspace left without an owner | The blockers are checked on the page, in the action, again in `prepare_account_deletion`, and by the trigger `guard_account_deletion` on `profiles`, which refuses the delete with `KR060` from any path, the Supabase dashboard included. `organizations.owner_id` stays `on delete restrict`. |
| Taking over an organization | `transfer_organization` locks the organization row, accepts only its current owner as caller and an owner of one of its workspaces as the new owner. Each transfer goes to `private.billing_events` and to the app log. |
| The firm's content leaving through the export | The export builder copies named columns only and never reads report, section, file or draft text (`src/lib/account/export.ts`, with unit tests). |
| The export kept in a cache | `Cache-Control: private, no-store`, `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. The service worker never caches `/api/`. |
| Cross-site requests | Next.js checks the `Origin` of server actions. The export is a GET: another site can make the browser download the person's own file, but cannot read it. |
| A token that outlives the account | Supabase keeps a deleted user's access token valid until it expires (1 hour). The middleware and the pages call `getUser()`, which fails once the user is gone, RLS finds no membership, and the deletion clears the Supabase and `kr-espace` cookies. |
| Personal data in logs | Lines carry the user id and counts. Never the e-mail address or the password; the logger also masks e-mail addresses and hides password fields (`src/lib/log/format.ts`). |

## Service role

The service role is used for one person at a time, by user id instead of `workspace_id`, because an account spans workspaces:

- the export reads invitations sent to the session's address or by its user, and the reports, deliverables, AI generations, exports, status changes and prompt versions created by its user, including those in workspaces the person left;
- the deletion calls `prepare_account_deletion` and `auth.admin.deleteUser` with the session's user id.

## To check on the hosted projects

- `prepare_account_deletion` sets `owner` and `owner_id` to null on `storage.objects` as the `postgres` role. It works locally. If a Supabase change ever removes that right, every deletion fails with a logged error and no account is deleted.
- An app deletion is not in the request log. After a backup restore, the accounts deleted since the backup come back (see the runbook, step 6).
