# Backups and restore

How KolabReport backs up the production database and the Storage files, how fast we can get them back, and how to rehearse a restore. It covers KRB-141 (database backups, PITR, restore drill) and KRB-142 (Storage backup) of story KRB-23. Both projects are on the Supabase Free plan today, so the backups below run in GitHub Actions and work without a paid plan. The paid path is described next to each step.

| Job | File | When | What it keeps |
| --- | --- | --- | --- |
| Database dump | `.github/workflows/backup-database.yml` | 01:41 UTC every night, production | Encrypted logical dump, 14 days |
| Storage copy | `.github/workflows/backup-storage.yml` | 02:11 UTC every night, production | Mirror of `deliverables` and `exports`, deleted files 30 more days |

Both also run by hand from the Actions tab, for production or staging. Each one only prints a notice until its secrets are set (see [Setup](#setup)).

## What Supabase gives, per plan

Checked on 2026-10-14 in the Supabase docs and pricing page (links below).

| Plan | Daily backups | Point-in-time recovery (PITR) | Restore to a new project |
| --- | --- | --- | --- |
| Free | None. Supabase recommends exporting with `supabase db dump` and keeping the copies off-site. | No | No |
| Pro ($25 a month) | Every day, the last 7 days, restore from **Database > Backups** | Add-on | Yes |
| Team | Last 14 days | Add-on | Yes |
| Enterprise | Up to 30 days | Add-on | Yes |

- PITR restores to any second inside its window. It costs about $100 a month for 7 days of window, $200 for 14 and $400 for 28. The project also needs at least the **Small** compute add-on (about $15 a month, against about $10 for the default Micro). Once PITR is on, Supabase stops taking daily backups: PITR replaces them.
- Projects on Postgres `15.8.1.079` or later get physical backups. These restore from the dashboard but can't be downloaded. For a file you can keep, take a logical dump with the CLI, which is what our nightly job does.
- A restore in place makes the project unavailable while it runs. Supabase gives no duration: it grows with the size of the database.
- **Restore to a new project** copies the database into a new project in the same region: schema, data, roles, Auth users with their password hashes, and the encryption root key. It does not copy Storage files and bucket settings, Auth settings and API keys, Edge Functions or Realtime settings. It needs a paid plan with physical backups, and the new project is billed like the source.
- Daily backups do not store the passwords of custom roles. We have none.
- Free projects are paused after one week without activity. Paid projects are never paused.
- Not verified: how much compute credit the Pro plan includes today. The pricing page did not show the amount on 2026-10-14. Check it on the billing page before turning on PITR.

Rough cost of the paid path for production only: Pro $25, Small compute about $15 minus the Pro compute credit, PITR 7 days about $100, so about $130 to $140 a month. Staging can stay on the Free plan.

Sources:

- Database backups, PITR and its price: https://supabase.com/docs/guides/platform/backups
- Compute sizes and prices: https://supabase.com/docs/guides/platform/compute-and-disk
- Plans, backup days, pausing: https://supabase.com/pricing
- Restore to a new project: https://supabase.com/docs/guides/platform/clone-project
- Logical dump and restore with the CLI: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Storage S3 keys and endpoint: https://supabase.com/docs/guides/storage/s3/authentication
- Storage S3 compatibility (no versioning): https://supabase.com/docs/guides/storage/s3/compatibility

## Storage files are not in the database backups

Supabase says it plainly: "Database backups do not include objects you store via the Storage API, as the database only includes metadata about these objects. Restoring an old backup does not restore objects you deleted after that backup."

For us that means:

- The rows of `storage.objects` (bucket, path, size, type) and of `deliverables` and `report_exports` are in every database backup, ours and Supabase's.
- The files themselves (the uploaded deliverables and the generated `.docx` and PDF exports) are not. After a database restore, a deliverable whose file is gone shows in the section but fails to download.
- Supabase Storage has no S3 versioning, so a file deleted in Storage is gone for good on the Supabase side.
- PITR does not change this. The Pro plan does not either.

So the Storage files need their own copy: [`backup-storage.yml`](#nightly-storage-copy). The database dump and the Storage copy run 30 minutes apart, so a restore of both from the same night matches closely. Two gaps remain: a file uploaded between the two runs is in the copy but its row is in no dump yet, and a file deleted between the two runs has its row in the dump but sits under `deleted/<date>/` instead of `mirror/`. After a real restore, look there for a file that a restored row expects.

## Targets

- **RPO** (recovery point objective): how much recent data we accept to lose.
- **RTO** (recovery time objective): how long until the app works again on the restored data.

| Data | RPO now (Free) | RTO now (Free) | RPO with Pro + PITR | RTO with Pro + PITR |
| --- | --- | --- | --- | --- |
| Database | 24 hours: the last nightly dump. 48 hours when a nightly run fails, and GitHub e-mails that failure. | 4 hours: new project, restore from the dump, settings, Vercel switch | 5 minutes: PITR restores to the second, we commit to 5 minutes | 2 hours: restore to a new project from the dashboard, then switch. In place: the restore time, unknown until the drill. |
| Storage files | 24 hours: files uploaded after the last nightly copy are lost | 4 hours for up to about 10 GB: copy back with rclone | 24 hours, unchanged | 4 hours, unchanged |
| Files deleted in the app | Recoverable for 30 days after the next nightly copy | Same, from `deleted/<date>/` | Same | Same |

The RTO numbers are targets until the first real drill measures them. The local rehearsal restored the data of a small database in under 2 seconds, so the time goes into the steps around it: creating the project, the settings and the checks.

Retention of the copies:

| Copy | Kept |
| --- | --- |
| Nightly database dump (GitHub artifact) | 14 days |
| Supabase daily backups (Pro) | 7 days |
| PITR window (add-on) | 7 days, or the window bought |
| Storage mirror (`mirror/`) | As long as the file exists in the app |
| Files deleted or replaced in the app (`deleted/<date>/`) | 30 days after the nightly copy that moved them, then the R2 lifecycle rule removes them |

## Nightly database dump

`backup-database.yml` follows the CLI steps of the Supabase guide with the CLI version from `package-lock.json`. `supabase db dump` runs `pg_dump` in the Postgres image that matches `major_version = 17` in `supabase/config.toml`. The job writes:

| File | Holds |
| --- | --- |
| `roles.sql` | Settings of the Supabase roles (`supabase db dump --role-only`) |
| `schema.sql` | Our schemas (`public`, `private`), extensions, functions, policies, the Realtime publication |
| `data.sql` | Every row, `auth` and `storage.objects` included, as `COPY` |
| `history_schema.sql`, `history_data.sql` | `supabase_migrations`, so `supabase db push` knows which migrations already ran |
| `extras.sql` | Our trigger on `auth.users` and our policies on `storage.objects`. `supabase db dump` leaves the `auth` and `storage` schemas out, and these with them. The file drops and creates them, so it can run twice. |
| `row-counts.tsv` | Rows per table at dump time, to compare after a restore |
| `MANIFEST`, `SHA256SUMS` | Date, environment, commit, CLI version, and a checksum per file |

The job then puts the folder in a `.tar.gz`, encrypts it with [age](https://age-encryption.org) for the public key in `BACKUP_AGE_RECIPIENT`, and uploads only the encrypted file as the artifact `database-<environment>-<date>`, kept 14 days. The run summary shows the file's size, its SHA-256 and the row count of each table. It never prints the connection string. The job fails, and GitHub e-mails you, when a dump fails or when the dump has no `public.reports` table.

The plain dump only exists on the GitHub-hosted runner while the job runs. See [`docs/gdpr/processors.md`](../gdpr/processors.md#backups) for what that means for data protection.

## Nightly Storage copy

`backup-storage.yml` installs rclone `v1.75.2` from `downloads.rclone.org` and checks its SHA-256. rclone gets its two remotes from environment variables only (`RCLONE_CONFIG_SUPABASE_*` and `RCLONE_CONFIG_BACKUP_*`), and writes no config file.

For each bucket (`deliverables`, `exports`), it runs:

```bash
rclone sync "supabase:<bucket>" "backup:$BACKUP_S3_BUCKET/mirror/<bucket>" \
  --backup-dir "backup:$BACKUP_S3_BUCKET/deleted/<YYYY-MM-DD>/<bucket>" \
  --max-delete "$MAX_DELETE" --checksum
```

So the backup bucket holds:

```text
mirror/deliverables/<workspace_id>/<section_id>/<file>    same files as in Supabase
mirror/exports/<workspace_id>/...
deleted/2026-10-14/deliverables/...                       removed from mirror/ that night
```

- A file deleted in the app, by a user or by the storage cleanup job (`docs/deployment.md`), leaves `mirror/` at the next run and moves to `deleted/<date>/`.
- A lifecycle rule on the bucket deletes everything under `deleted/` 30 days after it got there. Cloudflare removes expired objects within about 24 hours. So a deleted file is out of every copy at most about 32 days after it was deleted in the app.
- Only new and changed files are downloaded each night. `--checksum` compares sizes and MD5 hashes from the listings.
- A wrong source, such as an empty bucket or the keys of another project, would move the whole mirror to `deleted/<date>/`. To stop that early, a run that would remove more than 200 files from a bucket's mirror fails with an error, which GitHub e-mails (`--max-delete`). After a real mass deletion in the app, such as a large workspace removed on request, run the job by hand once with the repository or environment variable `BACKUP_MAX_DELETE` set higher, then remove it. If a wrong source got through anyway, nothing is lost for 30 days: copy the files back to `mirror/` with `rclone copy` and fix the secrets.
- The log stays at rclone's NOTICE level, so file names, which can hold personal data, only show up in errors. The summary shows counts and sizes per bucket, and a warning when Supabase and the mirror differ after the sync. Files uploaded during the run explain a small gap.
- The files are stored as they are, not encrypted by us. R2 encrypts every object at rest with AES-256 (https://developers.cloudflare.com/r2/reference/data-security/). The bucket is in the EU jurisdiction and only the backup token reaches it.

Cost: R2's free tier covers 10 GB-month of storage, 1 million Class A and 10 million Class B operations a month, and egress is free. Beyond that, storage costs $0.015 per GB-month (https://developers.cloudflare.com/r2/pricing/).

## Setup

Do this on the `production` environment first, then on `staging` if you want staging backed up too. The secrets live in **Settings > Environments > \<environment\>** on GitHub, next to the ones from `docs/deployment.md`.

### Database dump

1. Make a backup key on your own machine, not on a server:

   ```bash
   age-keygen -o kolabreport-backup.key
   # Public key: age1...
   ```

   Keep `kolabreport-backup.key` in the password manager, plus a second copy offline. Without it no backup can be read. It never goes to GitHub.
2. Variable `BACKUP_AGE_RECIPIENT` on the environment: the `age1...` public key. Several keys separated by spaces also work, for example yours and a second person's.
3. Secret `SUPABASE_DB_URL` on the environment: in the Supabase dashboard, **Connect**, the **Session pooler** string, with the database password filled in:

   ```text
   postgresql://postgres.<project-ref>:<password>@aws-0-eu-west-3.pooler.supabase.com:5432/postgres
   ```

   - It is the same value as `DIRECT_URL` in Vercel.
   - Not the direct connection `db.<project-ref>.supabase.co`: it is IPv6 only without the IPv4 add-on, and GitHub runners have no IPv6.
   - Not the transaction pooler on port 6543: `pg_dump` needs a session.
   - Percent-encode special characters of the password (`@` becomes `%40`, `/` becomes `%2F`).
4. **Actions > Backup database > Run workflow**, from `master`, environment `production`. Check the summary and download the artifact once to try the key: `age -d -i kolabreport-backup.key <file> | tar -tzf -`.

### Storage copy

1. **Supabase**, production project, the S3 settings of Storage (`https://supabase.com/dashboard/project/<project-ref>/storage/s3`): turn on the S3 connection if it is off. Copy the endpoint (`https://<project-ref>.storage.supabase.co/storage/v1/s3`) and the region (`eu-west-3`). Under the access keys, create a key for "GitHub backup" and copy the access key id and the secret. These keys can read and delete every file of every bucket and bypass RLS: they go nowhere but the GitHub environment.
2. **Cloudflare**, R2: create the bucket `kolabreport-backup-production`. Under **Location**, choose **Specify jurisdiction > European Union**. The jurisdiction can't change later. The S3 endpoint is then `https://<account-id>.eu.r2.cloudflarestorage.com` (https://developers.cloudflare.com/r2/reference/data-location/).
3. Cloudflare, **R2 > Manage API tokens > Create API token**: permission **Object Read & Write**, applied to that bucket only. Copy the access key id and the secret. The workflow sets `no_check_bucket`, so it never tries to create the bucket.
4. Cloudflare, the bucket's **Settings > Object lifecycle rules > Add rule**:

   | Field | Value |
   | --- | --- |
   | Name | `expire-deleted` |
   | Prefix | `deleted/` |
   | Action | Delete objects 30 days after upload |

   Leave `mirror/` without any rule: its files stay as long as they exist in the app. Wrangler can do the same with `npx wrangler r2 bucket lifecycle add` (https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
5. Secrets on the GitHub environment:

   | Secret | Value |
   | --- | --- |
   | `SUPABASE_S3_ENDPOINT` | `https://<project-ref>.storage.supabase.co/storage/v1/s3` |
   | `SUPABASE_S3_REGION` | `eu-west-3` |
   | `SUPABASE_S3_ACCESS_KEY_ID` | From step 1 |
   | `SUPABASE_S3_SECRET_ACCESS_KEY` | From step 1 |
   | `BACKUP_S3_ENDPOINT` | `https://<account-id>.eu.r2.cloudflarestorage.com` |
   | `BACKUP_S3_ACCESS_KEY_ID` | From step 3 |
   | `BACKUP_S3_SECRET_ACCESS_KEY` | From step 3 |
   | `BACKUP_S3_BUCKET` | `kolabreport-backup-production` |

   Another S3-compatible service works too: set the variable `BACKUP_S3_PROVIDER` to its rclone provider name (the default is `Cloudflare`). Keep it in the EU.
6. **Actions > Backup storage > Run workflow**, from `master`, environment `production`. Check the counts in the summary.

### Environment rules

- The production environment only accepts `master` and `v*` (`docs/deployment.md`). Scheduled runs use `master`. Run them by hand from `master` too.
- Both jobs use `deployment: false`: they read the environment's secrets without adding a deployment to its history.
- If you turn on **Required reviewers** for `production`, these jobs wait for your click every night as well. Then move the backup secrets to a `production-backups` environment without reviewers and change `environment.name` in the two workflows.
- GitHub runs scheduled workflows from the default branch only, so the jobs start once this is merged to `master`. A scheduled run can start late when GitHub is busy.

## Restore drill

Run it once before launch, then every 6 months and after any change to the backup jobs. Plan about 2 hours. Variant A works today. Variant B needs Pro and PITR.

The restored data is real production data: accounts, client reports and files. Treat the scratch project like production: EU West (Paris) region, nobody else invited, deleted at the end.

### Before you start

- Tools on your machine: `psql` 16 or later (`sudo apt install postgresql-client`, or `brew install libpq`), `age`, rclone `v1.75.2`, and optionally `gh`.
- The backup key `kolabreport-backup.key`.
- The row counts of the run you restore: open the run of **Backup database** and keep its summary open.
- A scratch Supabase project, `kolabreport-restore-drill`, in EU West (Paris), with a new database password. If Supabase refuses one more free project, pause staging during the drill.

### A. From a nightly dump

1. Download and decrypt the dump:

   ```bash
   gh run download <run-id> -n database-production-<date>
   age -d -i kolabreport-backup.key kolabreport-production-db-<date>.tar.gz.age | tar -xzf -
   cd kolabreport-production-db-<date>
   sha256sum -c SHA256SUMS
   cat MANIFEST
   ```

2. Point at the scratch project, with its Session pooler string. Read the project ref in it twice: this string must never be production's.

   ```bash
   export SCRATCH_DB_URL='postgresql://postgres.<scratch-ref>:<password>@aws-0-eu-west-3.pooler.supabase.com:5432/postgres'
   ```

3. Restore, in this order:

   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql \
     --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql \
     --dbname "$SCRATCH_DB_URL"
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file history_schema.sql --file history_data.sql --dbname "$SCRATCH_DB_URL"
   psql --single-transaction --variable ON_ERROR_STOP=1 --file extras.sql --dbname "$SCRATCH_DB_URL"
   ```

   `session_replication_role = replica` turns off triggers and foreign key checks while the rows go in, so `report_sections` (which points to itself) loads in any order. If psql stops on an `ALTER ... OWNER TO "supabase_admin"` line or on a grant to `cli_login_postgres`, the troubleshooting part of the Supabase guide says which line to comment out.

4. Count the rows and compare them with the run summary (the SQL editor of the scratch project works too):

   ```sql
   select table_schema || '.' || table_name as "table",
     (xpath('/row/n/text()', query_to_xml(
       format('select count(*) as n from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint as rows
   from information_schema.tables
   where table_type = 'BASE TABLE'
     and (table_schema in ('public', 'private')
       or (table_schema, table_name) in (('auth', 'users'), ('storage', 'buckets'), ('storage', 'objects')))
   order by 1;
   ```

5. Copy the Storage files back. In the S3 settings of the scratch project's Storage, create an access key. The buckets came back with the database rows (`storage.buckets`), so they already exist.

   ```bash
   export RCLONE_CONFIG=/dev/null
   export RCLONE_CONFIG_BACKUP_TYPE=s3 RCLONE_CONFIG_BACKUP_PROVIDER=Cloudflare RCLONE_CONFIG_BACKUP_REGION=auto
   export RCLONE_CONFIG_BACKUP_ENDPOINT='https://<account-id>.eu.r2.cloudflarestorage.com'
   export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID='...' RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY='...'
   export RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true
   export RCLONE_CONFIG_SCRATCH_TYPE=s3 RCLONE_CONFIG_SCRATCH_PROVIDER=Other RCLONE_CONFIG_SCRATCH_FORCE_PATH_STYLE=true
   export RCLONE_CONFIG_SCRATCH_ENDPOINT='https://<scratch-ref>.storage.supabase.co/storage/v1/s3'
   export RCLONE_CONFIG_SCRATCH_REGION=eu-west-3
   export RCLONE_CONFIG_SCRATCH_ACCESS_KEY_ID='...' RCLONE_CONFIG_SCRATCH_SECRET_ACCESS_KEY='...'

   rclone copy backup:kolabreport-backup-production/mirror/deliverables scratch:deliverables --checksum
   rclone copy backup:kolabreport-backup-production/mirror/exports scratch:exports --checksum
   ```

   To bring back a file deleted in the last 30 days, copy from `deleted/<date>/deliverables` the same way. For the drill, create a second R2 token with **Object Read only** on the backup bucket, so a typo can't change the backup. Writing a file over S3 where the restored `storage.objects` row already exists has not been tested on a hosted project yet: note in the drill log whether the files download in step 8.

6. Auth settings of the scratch project, **Auth > URL Configuration**: Site URL and redirect URL set to the preview of step 7 (`https://<preview-host>/fr/auth/callback`). Leave SMTP empty and don't ask for password resets: the accounts are real people.

7. Point a Vercel preview at the scratch project:
   1. Push a branch from `master`: `git switch -c restore-drill-<date> master && git push -u origin restore-drill-<date>`.
   2. Vercel, **Settings > Environment Variables**: add these for **Preview**, limited to the branch `restore-drill-<date>`. Branch-specific preview variables work on every plan, Hobby included (https://vercel.com/docs/environment-variables).

      | Variable | Value |
      | --- | --- |
      | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Scratch project |
      | `SUPABASE_SERVICE_ROLE_KEY` | Scratch project, Sensitive |
      | `DATABASE_URL`, `DIRECT_URL` | Scratch project pooler strings, Sensitive |
      | `NEXT_PUBLIC_APP_URL` | The branch URL of the preview |
      | `EMAIL_PROVIDER` | `none`, so no invitation or status e-mail goes to real people |
      | `AI_DRAFTS_ENABLED` | `false`, so no report content goes to the AI provider |

   3. **Deployments**, the branch's deployment, **Redeploy** without the build cache, so the `NEXT_PUBLIC_*` values are built in.
   4. Keep **Vercel Authentication** on for previews during the drill.

8. Checks, on the preview:

   | Check | Pass when |
   | --- | --- |
   | `GET /api/health` | `200` and `"status":"ok"` |
   | Row counts (step 4) | Equal to the run summary, table by table |
   | Sign in with your own production account | You land on your workspaces |
   | Open a report | `/fr/rapports/<id>` shows its sections and their text |
   | Download a deliverable | The file opens and is the right one |
   | Download an export | The PDF of a final report opens |

9. Clean up: delete the scratch project (**Settings > General > Delete project**), remove the branch variables in Vercel, delete the branch on GitHub and its preview deployment, revoke the read-only R2 token of step 5, then `rm -rf kolabreport-production-db-*` on your machine.
10. Fill in the [drill log](#drill-log). Open a Jira bug for anything that failed, and fix this page.

### B. From PITR (Pro and PITR)

1. Production project, **Database > Backups > Restore to a New Project**. Pick a date and time, for example one hour ago, and read the cost before you confirm. Supabase creates the project in the same region with the same compute size.
2. Note how long it takes, for the RTO.
3. It is a binary copy: schema, data, roles, Auth users and passwords, the migration history, our trigger and policies. Extensions that call out (`pg_net`, `pg_cron`) would start at once: we use none today (`pg_stat_statements`, `pgcrypto`, `uuid-ossp`, `supabase_vault` only).
4. Storage files and Storage settings are not copied: do step A5 with the new project as `scratch`, and check the two buckets under **Storage**.
5. Then steps A6 to A10. Compare the row counts with the dump closest in time.

### Using a restore for real

- **In place** (PITR or daily backup on production): the app is down during the restore, and everything written after the chosen point is lost. Restore the Storage files deleted since then from `deleted/<date>/`.
- **New project, then switch**: restore as in the drill, then put the new project's values in Vercel (Production) and in the GitHub `production` environment (`SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL`, the `SUPABASE_S3_*` secrets), set Auth URLs, SMTP and templates (`npx supabase config push`), and redeploy.
- After any restore, apply again every erasure answered since the backup date, from the request log ([`docs/gdpr/data-subject-requests.md`](../gdpr/data-subject-requests.md)).

## Drill log

One row per drill. Times in minutes.

| Date | Kind | Backup used | Restore time | Row counts | Sign-in | Report opens | Deliverable downloads | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-14 | Local rehearsal, not the real drill | Dump of the local stack, made by the workflow's own step script | Under 0.1 (1.4 s for the three `psql` commands) | Equal on all 20 tables of the count query | Not tested | Not tested | Not tested | See below |
| | Real drill A (nightly dump) | | | | | | | |

Local rehearsal of 2026-10-14 (KRB-141):

- Source: database `postgres` of the local stack (container `supabase_db_kolab-report-bj`, Postgres 17.11, Supabase CLI 2.120.0), read only: 815 users, 404 reports, 392 sections, 59 deliverable rows.
- The dump came from the step script of `backup-database.yml`, run as is against the local stack, then age-encrypted (744 KB), decrypted, and checked with `sha256sum -c`.
- Target: a database `restore_drill` in the same container, given the platform schemas of a new Supabase project (`auth`, `storage`, `extensions`, `realtime`, `vault` and the others) without our customizations. `roles.sql` was skipped: roles belong to the whole Postgres cluster, which source and target shared.
- Steps A3 and A4 as written above, with psql 16, in two runs: first by hand, then with the files of the workflow's script. No error. Same row counts on every table, same MD5 over the rows of `reports`, `report_sections`, `deliverables` and `auth.users` (id, e-mail, password hash), the same 38 policies, the trigger on `auth.users` and the migration history. `extras.sql` ran twice without error. `restore_drill` was dropped after each run.
- Found and fixed: `supabase db dump` leaves out our trigger on `auth.users` (new users would get no profile) and our two policies on `storage.objects` (nobody could upload or read a deliverable). The workflow now writes them to `extras.sql`.
- Storage: `rclone sync` with `--backup-dir` and the copy back were run against two local S3 servers (`rclone serve s3`). A deleted file moved to `deleted/<date>/`, a new file was copied, and both came back with `rclone copy`. Not run against Supabase Storage or R2.
- Not covered: sign-in, report page, deliverable download and the Vercel preview. The local stack has a single Auth service and no Storage service.
