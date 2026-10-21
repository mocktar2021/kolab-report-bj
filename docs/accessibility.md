# Accessibility

KolabReport targets WCAG 2.1 level AA, in French. This page lists what the tests check on every run, what was checked by hand during the KRB-155 pass, what is still not covered, and a checklist for new components.

Run the accessibility tests against a production build, with the local Supabase stack running:

```sh
npm run build
npm run test:e2e -- tests/e2e/accessibility.spec.ts tests/e2e/keyboard.spec.ts
```

## What runs automatically

| Spec | What it checks |
| --- | --- |
| `tests/e2e/accessibility.spec.ts` | axe-core 4.14 (`@axe-core/playwright`) with the `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa` rules. Any violation fails the test. Every page runs in the light and the dark theme, set through the `kolabreport:theme` key in localStorage like the theme menu does. |
| `tests/e2e/keyboard.spec.ts` | The sign-in, upload and AI draft flows with the keyboard only (Tab, Shift+Tab, Enter, Space, Escape, arrows), plus the skip link, landmarks, page titles, focus indicators, menus, dialogs and French names. |
| `src/components/auth/password-input.test.tsx` | The show password toggle keeps one name and changes `aria-pressed`. |
| `src/app/[locale]/(app)/espaces/[workspaceId]/sections/[sectionId]/draft-panel.test.tsx` | The feedback button keeps the focus once the opinion is saved. |
| `src/app/[locale]/(app)/espaces/[workspaceId]/sections/[sectionId]/section-editor.test.tsx` | The section editor opens with the focus in the text. Its toolbar is one tab stop: the arrow keys, Home and End move between the buttons, Alt+F10 goes there from the text and Escape goes back. Formatting buttons carry `aria-pressed`, the link button `aria-expanded`. The "Texte" and "Markdown" tabs work with the arrow keys. |
| `src/app/[locale]/(app)/tableau-de-bord/new-report-dialog.test.tsx` | The "Nouveau rapport" dialog opens on its field, ties a title error to it, keeps the title when the server refuses it, and gives the focus back to the button on cancel. |
| `tests/e2e/workspaces.spec.ts` | The same dialog in the browser: Escape gives the focus back to the button, Enter opens it again. The wizard's organization choice is a group of radio buttons named by its legend. |

The axe audit covers:

- Public pages: `/fr`, `/fr/connexion` (also with a sign-in error), `/fr/inscription`, `/fr/mot-de-passe-oublie`, `/fr/hors-ligne`.
- Signed-in pages: dashboard, workspace members, master report, section page (upload zone, file list, AI draft panel), prompt library, AI dashboard, notifications with an unread item, new workspace wizard (with its organization choice), and the dashboard at phone width.
- Interactive states: file preview open, delete dialog, AI draft proposal (preview, differences, editor), section editor ("Texte" tab with a table and the link form, "Markdown" tab), command palette, theme menu, workspace menu, new report dialog with a title error, remove member dialog, phone menu.

The keyboard spec checks:

- Sign-in: the tab order (logo, e-mail, forgotten password link, password, show password, submit, sign-up link, back home), submit with Enter, the error in a `role="alert"` tied to the fields with `aria-invalid` and `aria-describedby`, the focus back on the field to fix, and the new page title read by the Next.js route announcer.
- Sign-up and forgotten password: the focus goes to the first field in error, which carries its message as description.
- Signed-in pages: "Aller au contenu principal" is the first tab stop and moves the focus to `main`, one banner, one named navigation and one main, unique French titles, and a visible focus indicator on every tab stop of the dashboard, the report and the section page.
- Menus and dialogs: the theme menu, the workspace menu, the command palette (also with Ctrl+K), the phone menu and the remove member dialog have a French name and give the focus back to the control that opened them. Removing a member moves the focus to the list and says who left.
- Report: a manager adds a section and assigns it to an expert from the keyboard. The new section is announced and the focus stays on the field, then on the save button.
- No English in the accessibility tree or in `aria-label`, `title`, `alt` and `placeholder` values, on the main pages and in the portals.
- Upload: the file chooser opens with Enter and with Space, refusals are announced with their reason in a `role="log"`, the progress list is not a live region, a deleted file is confirmed in a dialog, the focus then goes to the list title, and the end of a file's read is announced.
- AI draft: the generate button is reachable and named, the status line is polite (`role="status"`) and never reads the streamed text, the view tabs work with the arrow keys, rating and comment work from the keyboard, the focus goes to the section text after accepting and to the generate button after discarding, and an error is announced in a `role="alert"` while the focus stays on the button.

The accepted upload test (announcement, then the new file reachable with Tab) needs the Storage container. CI runs it and never skips it; locally it is skipped when Storage does not answer.

axe 4.14 also checks Label in Name (WCAG 2.5.3, `label-content-name-mismatch`) on controls named by an `aria-label`. It compares the name with all the visible text, including text hidden from assistive tech such as the "Ctrl K" shortcut. KRB-222 dropped the `aria-label` on three controls and builds their name from what they show, with the extra words in an `sr-only` span:

| Control | Visible text | Name |
| --- | --- | --- |
| Search button | Rechercher Ctrl K | Rechercher (the shortcut stays hidden) |
| Workspace switcher | Espace Parakou, Cabinet Zinsou | Espace de travail actuel : Espace Parakou |
| Organization row in the workspace menu | Cabinet Zinsou 2 | Cabinet Zinsou : 2 espaces |

Chromium puts a space before and after an `sr-only` span that sits next to visible text, so its words go before the visible text or are joined with " : ".

Two faded illustration groups on the landing page carry `data-decorative` and axe skips them. They are `aria-hidden` pictures of the product, so their text is incidental and has no contrast requirement (WCAG 1.4.3). Never put this attribute on text people need to read.

## Manual checks done in KRB-155

There is no screen reader in the build environment. The checks below drove Chromium through Playwright and read what assistive tech would get:

- The accessibility tree (`ariaSnapshot`, `getByRole`) for roles, names, descriptions and states such as `aria-pressed`, `aria-expanded` and `aria-selected`.
- A `MutationObserver` that records the text of every live region when it changes, as a stand-in for what a screen reader announces.
- `document.activeElement` after each key press, for focus order and focus loss.
- The sources of Radix and cmdk, for default English labels and focus handling.

Issues found and fixed:

| Where | WCAG | Issue | Fix |
| --- | --- | --- | --- |
| Command palette | 1.3.1, 4.1.2, 3.1.2 | cmdk named the result list "Suggestions" in English and left the search field with no name. A separator sat inside the listbox. | French names for the field and the list, separator hidden from assistive tech. |
| Palette, phone menu, every dialog | 2.4.3 | Radix only returns the focus to a `DialogTrigger`. Our dialogs open from plain buttons or Ctrl+K, so the focus fell to the page on close. | `DialogContent` and `SheetContent` give the focus back to the element that opened them. |
| Theme and workspace menus | 4.1.2 | Modal menus set `aria-hidden` on the page, including the focusable trigger. | Menus are not modal. |
| Sign-in | 3.3.1, 1.3.1, 2.4.3 | The error was not tied to the fields, and the focus fell to the page after a failed submit. | `aria-invalid` and `aria-describedby` on the fields, focus on the field to fix. |
| Sign-up, forgotten and new password | 2.4.3 | Same focus loss after a failed submit, and after the confirmation replaced the form. | Focus on the first field in error, or on the confirmation message. |
| Show password button | 4.1.2 | The name changed and `aria-pressed` changed too, so the state was given twice. | One name, the state in `aria-pressed`. |
| Upload zone | 4.1.3 | The progress list was a live region created with its first item and read every percent. | A `role="log"` always in the page announces the start, the result and the reason of a refusal. |
| Upload zone | best practice | The hidden file input was a second "Choisir des fichiers" control for screen readers. | The input is out of the accessibility tree; the button opens it. |
| File list | 2.4.3, 4.1.3 | Delete asked for confirmation inline and the focus fell to the page when the row went away. | Confirmation in a dialog, then the focus on the list title and a status line naming the deleted file. The end of a file's read is announced too. |
| Members | 2.4.3, 4.1.3 | Removing a member dropped the focus with the row. | Focus on the list title and a status line. |
| Report page | 2.4.3, 4.1.3 | Saving an assignment disabled the focused button. Adding a section with the button dropped the focus and nothing said the section was added. | `aria-disabled` on save, the focus back in the field and a status line naming the new section. |
| Draft feedback | 2.4.3 | "Envoyer mon avis" became disabled once saved and dropped the focus. | `aria-disabled`, so it keeps the focus. |
| Workspace mark, draft feedback | 1.4.3 | Coral initials (and the pressed rating button on hover) were between 4.1:1 and 4.47:1 on their tinted backgrounds. | Lighter tints. |
| Signed-in pages | best practice | No banner landmark on wide screens (the sidebar was an `aside`), skip link said "Aller au contenu". | The sidebar is the page `header`, the skip link says "Aller au contenu principal". |
| Search button | 2.5.3 | Visible text "Rechercher", name "Ouvrir la palette de commandes". | Name starts with the visible text. |

## Known limits

- Not tested with NVDA, JAWS, VoiceOver or TalkBack. The proxies above show what the browser exposes, not how each screen reader reads it: verbosity, the order of polite announcements, browse mode and the VoiceOver rotor still need a person. Start with the sign-in error, the upload log, the AI draft status line, the delete dialog and the section reordering on the report page.
- Only Chromium runs the tests. Firefox and Safari expose some ARIA differently.
- Not checked: zoom to 400 % and reflow (1.4.10), text spacing (1.4.12), forced colors (Windows high contrast), touch targets, and the PDF and .docx exports.
- Section reordering relies on the dnd-kit keyboard sensor and its French announcements. axe passes, but it was not tried with a screen reader.
- The "Mot de passe oublié ?" link sits between the e-mail and the password fields. It matches the visual order, so it stays.
- Other forms still disable their submit button while they save (invite a member, new workspace wizard, prompt editor). Chromium keeps the Tab starting point, but a screen reader loses its place. They were not part of this pass.
- `Auth.hidePassword`, `Deliverables.confirmDelete` and `Deliverables.confirmDeleteLabel` in `messages/fr.json` are no longer used. They stay because keys are not removed in this pass.

## Checklist for new components

- Every control has a French name from `messages/fr.json`. Icon-only buttons get an `aria-label`. When a control shows text, take the name from that text and add any extra words in an `sr-only` span, rather than an `aria-label`. The name must hold all the visible text in the same order, also text that is `aria-hidden`.
- Use the primitives in `src/components/ui`: `Dialog` and `Sheet` trap the focus and give it back, `DropdownMenu` handles the arrows and Escape, `NativeSelect` leaves the keyboard to the browser.
- Form errors: `aria-invalid` and `aria-describedby` on the field, then `useFocusOnError` from `src/components/auth/use-focus-on-error.ts` to move the focus. One `role="alert"` for an error that belongs to the whole form.
- Status changes go in a live region that is already in the page before its text changes: `role="status"` for one line, `role="log"` for a list of events. Never make streamed text or progress percentages live.
- When an action removes the focused element (delete, accept, close), move the focus to a stable target, such as a heading with `tabIndex={-1}`, and say what happened.
- Don't disable a focused button to say there is nothing to do. Use `aria-disabled` and ignore the click.
- Show the focus with `focus-visible:ring-2 focus-visible:ring-ring`, or keep the global outline. Never `outline-none` alone.
- Text keeps 4.5:1 in both themes, also on tinted backgrounds and hover states.
- Each page sets a unique French title with `generateMetadata` and has one `h1`.
- Add the new page or state to `tests/e2e/accessibility.spec.ts`, and its keyboard flow to `tests/e2e/keyboard.spec.ts`.
