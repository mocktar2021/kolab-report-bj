import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Token for an invitation link: 32 random bytes, URL-safe. Only its hash is
 * stored (workspace_invitations.token_hash), so a database leak gives no
 * usable link.
 */
export function createInvitationToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

/** Same hash as private.invitation_token_hash() in the invitations migration. */
export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
