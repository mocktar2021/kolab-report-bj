# KolabReport

## Writing

Use the `write-like-mocktar` skill (`.claude/skills/write-like-mocktar`) for every piece of prose: commits, PRs, Jira, docs, code comments and UI copy. Never use em dashes. Run `python3 .claude/skills/write-like-mocktar/scripts/check_prose.py <files>` before committing text.

## Commits

- Author: `Mocktar Tairou <94203523+mocktar2021@users.noreply.github.com>`.
- No Claude or AI attribution lines (no `Co-Authored-By: Claude`, no `Claude-Session:`, no "Generated with" footer).
- Subject: `KRB-<n> <lowercase imperative summary>`.

## Checks

Run before pushing: `npm run lint`, `npm run typecheck`, `npm run build`.

## Project rules

- UI text is French and lives in `messages/fr.json`. Routes are under `/fr`.
- Every tenant table has `workspace_id` and RLS. New tables need policies in the same migration.
- The service-role client (`src/lib/supabase/admin.ts`) is server-only and bypasses RLS. Scope every query by `workspace_id` when using it.
