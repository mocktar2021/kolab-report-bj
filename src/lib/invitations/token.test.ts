import { describe, expect, it } from "vitest";
import { createInvitationToken, hashInvitationToken } from "./token";

describe("invitation tokens", () => {
  it("hashes like private.invitation_token_hash() in Postgres", () => {
    // select private.invitation_token_hash('tok-1');
    expect(hashInvitationToken("tok-1")).toBe(
      "65dcf16ea3dfa49069628089eb4a75483070f5584b2a21ee64912b5f621f12da",
    );
  });

  it("creates a URL-safe 32-byte token with its hash", () => {
    const { token, tokenHash } = createInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(hashInvitationToken(token));
    expect(createInvitationToken().token).not.toBe(token);
  });
});
