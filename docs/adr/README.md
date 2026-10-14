# Architecture decision records

An ADR records one decision that shapes the code for a long time: the context, what we chose, what we left out and why. Write one before a change that touches the schema of several tables, money, security or an outside provider.

## How to add one

1. Copy the layout of the latest ADR: context, decision, consequences, open questions.
2. Name it `NNN-short-title.md` with the next free number, three digits.
3. Set its status at the top: `Proposed`, `Accepted`, `Superseded by NNN` or `Rejected`.
4. Link the Jira story. Supporting files (a plan, a draft migration) share the ADR's number.

An ADR is not edited once accepted, apart from its status and typo fixes. A new decision gets a new ADR that supersedes the old one.

## Index

| Number | Title | Status |
| --- | --- | --- |
| [001](001-billing-and-fedapay.md) | Billing per organization, paid through FedaPay | Proposed |

Supporting files of 001: [implementation plan](001-billing-and-fedapay-plan.md), [draft schema](001-billing-schema-draft.sql) (illustration only, never applied).
