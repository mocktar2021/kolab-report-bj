// Types for scripts/supabase-auth-emails.mjs, so its test can import it.
type Section = { subject?: string; content_path?: string; enabled?: boolean };

export function parseEmailSections(toml: string): {
  template: Record<string, Section>;
  notification: Record<string, Section>;
};
export function templateFields(
  toml: string,
  read?: (file: string) => Promise<string>,
): Promise<Record<string, string | boolean>>;
export function smtpFields(env: Record<string, string | undefined>): Record<string, string> | null;
export function urlFields(
  env: Record<string, string | undefined>,
): { site_url: string; uri_allow_list: string } | null;
