type Env = Record<string, string | undefined>;

export declare const TURNSTILE_ORIGIN: "https://challenges.cloudflare.com";
export declare function contentSecurityPolicy(env: Env): string;
