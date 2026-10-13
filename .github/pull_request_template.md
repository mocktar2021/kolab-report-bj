## Jira

KRB-

## What changed

-

## How to test

-

## Checklist

- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass locally
- [ ] New tables have `workspace_id`, RLS policies in the same migration and a pgTAP test file
- [ ] Migration changes come with a fresh `npm run db:types`
- [ ] UI text is in `messages/fr.json`
- [ ] Auth or routing changes: `npm run test:e2e` passes against the local stack
- [ ] Commits follow `KRB-<n> <summary>` and the writing check passes
