// Password policy of the sign-up and new password forms (KRB-58). Supabase
// Auth checks the same rules: minimum_password_length and
// password_requirements = "letters_digits" in supabase/config.toml, pushed to
// the hosted projects by scripts/supabase-auth-settings.mjs.
// password-policy.test.ts fails when the two drift apart.
//
// No zod here: the client forms import this file.

export const PASSWORD_MIN_LENGTH = 10;

// bcrypt, used by Supabase Auth, reads at most 72 bytes. Accented letters
// take two bytes in UTF-8.
export const PASSWORD_MAX_BYTES = 72;

export function passwordBytes(password: string): number {
  return new TextEncoder().encode(password).length;
}

/**
 * Supabase's "letters_digits" rule: at least one letter a-z or A-Z and one
 * digit. Accented letters do not count as letters there, so not here either.
 */
export function hasLetterAndDigit(password: string): boolean {
  return /[A-Za-z]/.test(password) && /[0-9]/.test(password);
}
