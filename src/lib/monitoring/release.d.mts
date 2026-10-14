type Env = Record<string, string | undefined>;

export declare function sentryRelease(env: Env): string | undefined;
export declare function sentryEnvironment(env: Env): "production" | "staging" | "development";
export declare function canUploadSourceMaps(env: Env): boolean;
