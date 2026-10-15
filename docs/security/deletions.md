# Deletions

Who can delete a report, a workspace or an organization in KolabReport, and what goes with it (KRB-180). The database checks every rule: `delete_report`, `delete_workspace` and `delete_organization`, from the deletions migration of KRB-180, are the only way a signed-in user deletes these rows. The DELETE privilege on `reports`, `workspaces` and `organizations` is revoked from `authenticated`, and the delete policies of `reports` and `workspaces` are gone, so the API refuses a direct delete with `42501`.

## Who can delete what

| What | Who | Confirmation | Where in the app |
| --- | --- | --- | --- |
| Report, not final | Owners and admins of its workspace | Dialog that names what goes | "Supprimer le rapport" at the bottom of the report page |
| Report, final | Owners of its workspace | Dialog, and the exact title typed | Same. Admins see why they cannot |
| Workspace | Owners of the workspace | Dialog, and the exact name typed | `/fr/espaces/<id>/parametres`, "Paramètres de l'espace" in the workspace menu (owners only) |
| Organization | Its owner (`organizations.owner_id`) only | Dialog listing every workspace and the billing time lost, and the exact name typed | `/fr/organisations/<id>`, "Gérer l'organisation" in the workspace menu (organization owner only), or the dashboard once no workspace is left |

Everyone else is refused. Experts, viewers, admins of a workspace for its deletion, and owners of a workspace for its organization get `42501`. Someone outside the workspace or the organization gets `P0002`, the same answer as for an id that does not exist. The functions need a signed-in user: the service role gets `42501`, and operators delete with SQL only when no owner can do it ([`data-subject-requests.md`](../gdpr/data-subject-requests.md#deleting-a-workspace-or-an-organization)).

The typed title or name is checked again in the database (`KR070`): the same text once the spaces around it are trimmed, accents compared in one Unicode form, case included.

The organization owner deletes every workspace of the organization, including the ones they are not a member of. Workspace owners cannot delete their organization, and the organization owner cannot delete one workspace alone unless they own it.

A read-only workspace (billing, KRB-178) can still be deleted: none of the functions reads the billing state.

## What goes and what stays

| Deleted | Goes with it | Stays |
| --- | --- | --- |
| Report | Sections, deliverable rows, exports and final snapshots, status history, notifications. Files are queued for removal | AI generations of its sections, with `section_id` set to null, so their tokens and drafts still count |
| Workspace | Members, invitations, reports and all they hold, prompt templates and rollouts, AI generations, notifications, the Pass Mission entitlements of a mission workspace | The organization and its subscription. The organization's draft ledger (`workspace_id` set to null), so deleting a workspace never gives drafts back. Member accounts |
| Organization | Every workspace and all it holds, the buyer row, entitlements, Pack IA credits, the draft ledger | Payments and receipts (KRB-176), with `organization_id` set to null and a copy of the buyer in the receipt. `private.billing_events` and `private.billing_trial_claims`, which have no foreign key: a new organization of the same person gets no new trial. Member accounts |

The dialogs warn when time is lost: a running Pass Mission for a workspace; for an organization, the plan and the end of its last period (trial aside), the passes and the Pack IA drafts left. A period, a pass or a pack already started is not refunded (`/fr/cgv#remboursement`).

## How a deletion runs

In one transaction:

1. The caller's rights, as above.
2. Locks: the draft lock of each workspace concerned (the one `start_ai_generation` takes), then for a workspace or an organization the billing lock of the organization (always the last advisory lock), then the rows. A draft that starts in what is being deleted waits, then fails; one that started first goes with it. Uploads and exports are covered by the foreign keys and by the upload window of the cleanup queue. If a workspace is added to the organization while its deletion waits for the locks, it refuses with `40001` and the owner tries again.
3. The stored files are queued in `private.storage_cleanup_queue`: the files of the deliverable and export rows, and every object under the folders of what goes, including an export file no row records. The daily job (KRB-166) removes them. A deliverable registered less than 2 hours 15 minutes ago waits for its upload window.
4. The row is deleted; the foreign keys take the rest.
5. An event goes to `private.audit_events`: action, the user id, the ids of the organization, workspace and report, and in `details` the counts of what went, the status of the report, the role of the user and the billing time lost. No title, name or content. Nobody signed in reads it, not even the service role. Retention is **to decide** ([`retention.md`](../gdpr/retention.md)).

To see the deletions of an organization:

```sql
select created_at, action, actor_id, workspace_id, report_id, details
from private.audit_events
where organization_id = '<organization-id>'
order by created_at desc;
```

## After a deletion

- The user who deleted a report goes back to the dashboard. After a workspace or an organization, the workspace cookie (`kr-espace`) moves to another workspace they belong to, of the same organization first, or goes when none is left and they land on the wizard.
- Other members whose cookie names a deleted workspace see their first workspace on their next page: the app ignores a cookie that names no workspace of theirs.
- Pages kept offline by the service worker on a member's device stay until they sign out.

## Errors

| Code | Message |
| --- | --- |
| `42501` | Vous n'avez pas les droits pour faire cette suppression. |
| `P0002` | Introuvable : il a peut-être déjà été supprimé. Rechargez la page. |
| `KR070` | Le texte saisi ne correspond pas. Recopiez-le exactement pour confirmer. |
| `40001` | Un espace de travail vient d'être ajouté à l'organisation. Rechargez la page, relisez la liste, puis réessayez. |

## Tests

- `supabase/tests/deletions_test.sql`: rights of each role, cross-workspace attempts, cascades, files queued, draft ledger kept, billing rows, audit events, read-only workspaces.
- `tests/e2e/deletions.spec.ts`: each deletion through the pages, refusals for experts and viewers, files removed by the cleanup job (needs the Storage container).
- The smoke suite creates and deletes its own report on every deploy ([`smoke-tests.md`](../operations/smoke-tests.md)).
