// What the confirmation dialogs of KRB-180 check before they send a deletion.
// No zod and no server-only import: the dialog runs in the browser.

/**
 * Whether the typed text confirms a deletion: the same text as `expected`
 * once the spaces around both are trimmed, accents compared in one Unicode
 * form, case included. Mirrors private.confirmation_matches in the deletions
 * migration, which has the last word.
 */
export function confirmationMatches(typed: string, expected: string): boolean {
  const clean = (value: string) => value.trim().normalize("NFC");
  const value = clean(typed);
  return value.length > 0 && value === clean(expected);
}
