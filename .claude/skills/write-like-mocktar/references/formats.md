# Format templates

Templates and examples for each kind of text. All rules from SKILL.md still apply: no em dashes, plain words, no AI sentence shapes, no Claude attribution.

## Contents

- Commit messages
- PR titles and descriptions
- PR review replies
- Jira epics, stories, sub-tasks and comments
- README and docs
- UI copy (French and English)
- Landing page copy
- Chat replies and status updates

## Commit messages

```
<JIRA-KEY> <lowercase imperative summary, about 72 chars max>

<Optional body: one to three plain sentences on why, or on what is
deliberately not included. Wrap at about 72 characters.>
```

Good:

```
KRB-12 add RLS policies for report sections

Experts can update only the sections assigned to them. A trigger blocks
them from reassigning or re-weighting a section.
```

```
MOW-53 fail closed on Stripe environment mismatch
```

<!-- check-prose: off -->
Bad, and why:

- `feat: Implement robust and comprehensive RLS policies 🚀` (AI words, emoji, no key)
- `KRB-12 Add RLS [em dash] experts limited to their sections` (em dash, capitalized verb)
- Any `Co-Authored-By: Claude` or `Claude-Session:` trailer

<!-- check-prose: on -->

## PR titles and descriptions

Title: same shape as a commit subject. `KRB-1 scaffold Next.js PWA, Supabase schema and Jira backlog`.

Body:

```
## What
<Two to five bullets, each a concrete change: file, route, table, command.>

## Why
<One or two sentences. Link the Jira key.>

## How to test
<Numbered steps or commands someone can run.>

## Notes
<Only if needed: risks, follow-ups, things left out on purpose.>
```

Keep it short enough to read in a minute. No "Summary" section that repeats the title, no closing paragraph, no AI footer.

## PR review replies

One or two sentences. Say what you did or why you didn't.

- `Fixed in 3f2a1c0, the redirect now keeps the query string.`
- `Leaving this as is: the service role client only runs in route handlers, never in the browser bundle.`

<!-- check-prose: off -->
Not: `Great catch! Thanks so much for the thorough review. I've gone ahead and...`
<!-- check-prose: on -->

## Jira

**Epic summary**: a noun phrase naming the outcome. `Authentication and workspace roles`.

**Epic description**:

```
Goal: <one sentence>
Scope: <short list>
Done when: <short list of checks>
```

**Story summary**: what gets built, starting with a verb or a noun phrase. `Email and password sign-in in French`.

**Story description**:

```
As a <role>, I want <capability>, so that <reason>.

Acceptance criteria
- Given <state>, when <action>, then <result>.
- ...

Notes: <dependencies, links, Jira keys>
```

**Sub-task summary**: an imperative task. `Add /fr/mot-de-passe-oublie page`.

**Comment**: a status line with a link. `Scaffolded on branch feature/KRB-1-scaffold, pending review: <url>`.

## README and docs

- Open with one paragraph saying what the thing is and who uses it. No tagline.
- Then setup commands in a code block, then reference sections.
- Use "you" for instructions. Use tables for options and commands.
- Headings in sentence case: `Getting started`, not `Getting Started`.

## UI copy

French (KolabReport and other French products):

- `vous`, short labels, verbs on buttons: `Se connecter`, `Créer un compte`, `Téléverser un livrable`.
- Errors say what happened and what to do: `Adresse e-mail ou mot de passe incorrect.`
- Empty states say what to do next: `Aucun espace de travail pour le moment. Créez-en un pour commencer.`
<!-- check-prose: off -->
- Avoid: `N'hésitez pas à`, `Oups !`, `fluide`, `révolutionnaire`, `en toute simplicité`, em dashes (French uses them for asides, use commas or parentheses instead).
<!-- check-prose: on -->

English (MowFlow and others):

- Buttons are verbs: `Schedule job`, `Send invoice`.
- Errors are specific: `This client has no address. Add one to plan the route.`
- No exclamation marks in system messages.

## Landing page copy

Marketing text can have energy, but it still has to be concrete.

- Headline: the outcome for the customer, in plain words. `Plan every lawn job, route and invoice in one place.`
- Subhead: who it is for and the main proof point. `Built for crews of 2 to 50. Routes are planned in seconds, invoices go out the same day.`
- Feature blurbs: one sentence of what it does, one of what it saves.
- Numbers need a source or should be phrased as what the product does, not invented stats.
<!-- check-prose: off -->
- Avoid: `revolutionize`, `supercharge`, `seamless`, `effortless`, `world-class`, `all-in-one solution`, `take your business to the next level`, `Say goodbye to...`.
<!-- check-prose: on -->

## Chat replies and status updates

- Lead with the answer or the result.
- Then what's left or what you need from him.
- Bullets only when there are three or more separate items.
<!-- check-prose: off -->
- No "Great question", no "I hope this helps", no summary at the end.
<!-- check-prose: on -->

Example:

```
Pushed to feature/KRB-1-scaffold. Build, lint and typecheck pass.

Needs your call: the PR touches RLS policies, so I left it open for review.
```
