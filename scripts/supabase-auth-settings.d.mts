// Types for scripts/supabase-auth-settings.mjs, so its test can import it.
type Section = { subject?: string; content_path?: string; enabled?: boolean };
type Env = Record<string, string | undefined>;
type Fields = Record<string, string | number | boolean>;

export function parseSections(toml: string): Record<string, Record<string, string | number | boolean>>;
export function parseEmailSections(toml: string): {
  template: Record<string, Section>;
  notification: Record<string, Section>;
};
export function templateFields(
  toml: string,
  read?: (file: string) => Promise<string>,
): Promise<Record<string, string | boolean>>;
export function passwordFields(toml: string): {
  password_min_length: number;
  password_required_characters: string;
};
export function rateLimitFields(toml: string, withSmtp: boolean): Record<string, number>;
export function smtpFields(env: Env): Record<string, string> | null;
export function urlFields(env: Env): { site_url: string; uri_allow_list: string } | null;
export function captchaFields(env: Env): Fields | null;
export function authSettings(
  toml: string,
  env: Env,
  read?: (file: string) => Promise<string>,
): Promise<{ body: Fields; notes: string[] }>;
