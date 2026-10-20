// Types for scripts/check-settings.mjs, so its test can import it.
type Env = Record<string, string | undefined>;
type Environment = "production" | "staging";
type Finding = { level: "ok" | "warn" | "error"; where: "GitHub" | "Vercel"; name: string; message: string };
type VercelVariable = {
  key: string;
  target?: string[];
  type?: string;
  value?: string;
  decrypted?: boolean;
};

export const ORIGINS: Record<Environment, string>;
export const GITHUB: {
  secrets: string[];
  variables: string[];
  groups: { name: string; why: string; secrets: string[]; variables: string[] }[];
};
export const VERCEL: { required: string[]; oneOf: string[][]; recommended: string[]; secrets: string[] };
export function checkGitHub(environment: Environment, env: Env): Finding[];
export function jwtRef(key: string): string | null;
export function checkVercel(
  environment: Environment,
  variables: VercelVariable[],
  projectRef?: string,
): Finding[];
export function report(
  environment: Environment,
  findings: Finding[],
): { lines: string[]; markdown: string; ok: boolean };
