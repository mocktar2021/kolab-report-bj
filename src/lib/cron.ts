import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/** Vercel asks for a random CRON_SECRET of at least 16 characters. */
export const CRON_SECRET_MIN_LENGTH = 16;

/** False while CRON_SECRET is missing or too short: cron routes then refuse every call. */
export function cronSecretIsUsable(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= CRON_SECRET_MIN_LENGTH;
}

/**
 * True when `authorization` is "Bearer <secret>", the header Vercel Cron
 * sends once CRON_SECRET is set on the project. A missing or short secret
 * refuses everything, so "Bearer undefined" never gets in. The SHA-256
 * digests are compared in constant time: timing tells nothing about the
 * secret, its length included.
 */
export function isCronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!cronSecretIsUsable(secret) || !authorization) return false;
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const given = createHash("sha256").update(authorization).digest();
  return timingSafeEqual(expected, given);
}
