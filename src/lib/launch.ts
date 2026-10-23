// Launch of kolabreport.com (KRB-239): Tuesday 27 October 2026 at 09:00 in
// Cotonou, 08:00 UTC. Before it, production shows a countdown and a reminder
// form, and sign-up stays closed. Sign-in keeps working, for the owner and the
// smoke account. Other environments are always open, so staging, CI and local
// work never wait for the date.

export const LAUNCH_AT = new Date("2026-10-27T08:00:00.000Z");

type Env = Record<string, string | undefined>;

function isProduction(env: Env): boolean {
  return env.APP_ENV === "production" || env.VERCEL_ENV === "production";
}

/** True while production waits for the launch. */
export function isPrelaunch(now: Date = new Date(), env: Env = process.env): boolean {
  return isProduction(env) && now.getTime() < LAUNCH_AT.getTime();
}

/** The launch time as an ISO string while production waits for it, for the client countdown. */
export function prelaunchUntil(now: Date = new Date(), env: Env = process.env): string | undefined {
  return isPrelaunch(now, env) ? LAUNCH_AT.toISOString() : undefined;
}
