type Env = Record<string, string | undefined>;

export declare const TURNSTILE_ORIGIN: "https://challenges.cloudflare.com";
export declare const WEB_ANALYTICS_SCRIPT_ORIGIN: "https://static.cloudflareinsights.com";
export declare const WEB_ANALYTICS_REPORT_ORIGIN: "https://cloudflareinsights.com";
export declare function contentSecurityPolicy(env: Env): string;
