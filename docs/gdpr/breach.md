# Personal data breach

What to do when personal data that KolabReport holds is lost, exposed, changed or made unavailable without permission (KRB-236). Keep it short during an incident: contain first, write down what you see, then decide who to tell. The roles and the law behind it are in [`README.md`](README.md#controller-and-processor-roles). This is not legal advice: the lawyer reviews this page with the rest of the folder, and the points marked **to confirm** are theirs.

## Is it a breach?

A breach is a security incident in which personal data is destroyed, lost, changed, disclosed or read by someone who should not. For KolabReport, for example:

- A member of one workspace sees or downloads the reports, files or members of another (database rules, Storage, Realtime). It is also the P1 "data of one workspace visible to another" of the [launch run sheet](../operations/launch.md#severity-and-response).
- A secret leaks: the service role key, the database password or URL, the age key of the backups, or an API key that reads data (e-mail, AI, R2).
- A backup dump or the R2 copy of the files can be read by someone else.
- An export, a receipt or an invitation goes to the wrong person.
- A subprocessor tells us of a breach on their side ([`processors.md`](processors.md)).
- Data is deleted or damaged and no backup brings it back. Losing data counts, not only leaking it.

Not a breach, but log it as an incident anyway: an outage with no data lost, failed sign-in attempts, a weakness found and fixed before anyone used it.

## Who decides

The product owner decides whether it is a breach, who is told and what they are told. The backup on call (see [launch](../operations/launch.md#decisions-for-the-product-owner)) contains it and calls the product owner. When the product owner cannot be reached, the backup decides, so that the deadlines below still hold.

## The first hour

1. **Open the incident.** A Jira bug with the labels `incident` and `breach`, priority P1. Write in it, in UTC: when it started if known, when we found out, who found it and how. The clock of every deadline below starts when we found out.
2. **Contain it**, without deleting anything that shows what happened:
   - A release caused it: roll back the app in Vercel ([Rollback](../deployment.md#rollback)).
   - A secret leaked: rotate it at the provider first, then where it is stored, then redeploy ([Secrets rules](../deployment.md#secrets-rules)).
   - A feature leaks: turn it off. AI drafts go off with `AI_DRAFTS_ENABLED=false` on Vercel and a redeploy.
   - An account was taken over: reset its password and end its sessions in Supabase Auth.
3. **Keep the evidence now.** Logs do not wait: Vercel keeps runtime logs 1 day on Pro ([Logs](../operations/monitoring.md#logs)), and Supabase Free keeps its logs 1 day. Copy the lines that matter, the Sentry issue links and the request ids into the Jira issue.

## Size it

Answer these in the Jira issue. They decide who must be told.

- Which data: report content (reports, sections, files, AI drafts, exports), account data (e-mail, name, sessions), billing details, or secrets.
- Whose data, and how many people: which workspaces and organizations, which accounts.
- Read, copied, changed or lost? Still exposed?
- Who could have seen it: nobody outside, a member of another firm, anyone on the internet.

The owners of a firm, to tell them:

```sql
select o.name as organization, p.full_name, p.email
from public.organizations o
join public.profiles p on p.id = o.owner_id
where o.id = '<organization-id>';
```

The owners of one workspace are in [`data-subject-requests.md`](data-subject-requests.md#find-the-person).

## Who to tell, and when

| Data | Our role | Tell | When |
| --- | --- | --- | --- |
| Report content and the members of a workspace | Processor for the firm | The owners of each firm concerned. The firm decides whether to tell its authority and its clients, and we help it | Without undue delay. Our target: within 24 hours of finding out, so the firm can meet its own 72 hours |
| Accounts, security logs, billing details | Controller | The authority, unless the breach is unlikely to put anyone at risk | Within 72 hours of finding out. If facts are missing, tell what is known and complete it later |
| The same | Controller | The people concerned, when the risk to them is high (passwords, a leak that allows fraud) | Without undue delay, in plain French |

**Which authority** (to confirm). Mocktar Technologies is established in Benin, so the APDP (Autorité de protection des données à caractère personnel, apdp.bj) under the Code du numérique, Livre 5 (law 2017-20 as revised by law 2020-35). The article, its delay and the notification form are to confirm with the lawyer. A European authority only if the GDPR applies to us, which the open action in [`README.md`](README.md#open-actions-for-the-owner) asks.

A subprocessor's breach follows the same table: what it exposed decides who we tell.

## Message to a firm

Sent by the product owner from `support@mocktar.com` to the owners of the firm, with `vous`. Fill the brackets, remove what does not apply, and keep facts only: no guess about the cause before we know it.

> Objet : Incident de sécurité sur votre espace KolabReport
>
> Bonjour,
>
> Le [date] à [heure] (heure de Cotonou), nous avons constaté un incident de sécurité qui concerne des données de votre organisation [nom].
>
> Ce qui s'est passé : [faits connus].
> Données concernées : [rapports, fichiers, membres, comptes], pour [nombre] personnes ou éléments.
> Ce que nous avons fait : [mesures prises], le [date] à [heure].
> Ce que nous vous conseillons : [changer de mot de passe, prévenir tel client, rien à faire].
>
> En tant que responsable du traitement pour le contenu de vos rapports, il vous revient de décider s'il faut informer l'autorité de protection des données et les personnes concernées. Nous vous aidons à le faire et vous enverrons les éléments qui manquent dès que nous les aurons.
>
> Pour toute question : support@mocktar.com.
>
> [Prénom Nom], Mocktar Technologies

## After

- Find the cause and fix it with a test that fails before the fix: a pgTAP test for a database rule, an end-to-end test for a page.
- Within 5 working days, write in the Jira issue what happened, what we changed and what we will watch.
- Close the issue only when every person to tell was told, and the log below is complete.

## Incident log

Every breach goes in the log, even when nobody had to be told: the authority can ask for it. The log is the list of Jira issues with the label `breach`. Each issue holds:

- when it started and when we found out;
- what data, whose and how many;
- the cause, and what we did to contain and fix it;
- who was told and when, or why nobody was.
