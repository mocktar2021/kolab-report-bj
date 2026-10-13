import type { AuthError } from "@supabase/supabase-js";

export type AuthErrorKey =
  | "weakPassword"
  | "samePassword"
  | "rateLimited"
  | "sessionExpired"
  | "emailNotConfirmed"
  | "unknown";

/** Maps a Supabase Auth error to a key under Auth.errors in messages/fr.json. */
export function authErrorKey(error: AuthError): AuthErrorKey {
  if (error.name === "AuthSessionMissingError") return "sessionExpired";
  switch (error.code) {
    case "weak_password":
      return "weakPassword";
    case "same_password":
      return "samePassword";
    case "email_not_confirmed":
      return "emailNotConfirmed";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "rateLimited";
    case "session_not_found":
    case "session_expired":
    case "otp_expired":
      return "sessionExpired";
    default:
      return error.status === 429 ? "rateLimited" : "unknown";
  }
}
