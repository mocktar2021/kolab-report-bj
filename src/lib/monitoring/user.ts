import "server-only";
import { setUser } from "@sentry/nextjs";

/**
 * The only user data Sentry gets: the Supabase user id. No e-mail, name or
 * IP address. null clears it. Does nothing visible while Sentry is off.
 * Server side: the browser sets the same id in MonitoringUser.
 */
export function setMonitoringUser(id: string | null): void {
  setUser(id ? { id } : null);
}
