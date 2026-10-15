import { describe, expect, it } from "vitest";
import { isBillingError, workspaceErrorKey } from "./errors";

describe("workspaceErrorKey", () => {
  it("maps the RBAC trigger codes", () => {
    expect(workspaceErrorKey({ code: "KR001" })).toBe("lastOwner");
    expect(workspaceErrorKey({ code: "KR002" })).toBe("assigneeNotMember");
  });

  it("maps the invitation codes", () => {
    expect(workspaceErrorKey({ code: "KR003" })).toBe("invitationInvalid");
    expect(workspaceErrorKey({ code: "KR004" })).toBe("invitationUsed");
    expect(workspaceErrorKey({ code: "KR005" })).toBe("invitationExpired");
    expect(workspaceErrorKey({ code: "KR006" })).toBe("invitationOtherEmail");
    expect(workspaceErrorKey({ code: "KR007" })).toBe("alreadyMember");
    expect(workspaceErrorKey({ code: "23505" })).toBe("invitationPending");
  });

  it("maps the frozen final report code", () => {
    expect(workspaceErrorKey({ code: "KR020" })).toBe("reportFinal");
  });

  it("maps the billing codes to messages without numbers", () => {
    expect(workspaceErrorKey({ code: "KR040" })).toBe("billingLimit");
    expect(workspaceErrorKey({ code: "KR041" })).toBe("seatLimitInvitee");
    expect(workspaceErrorKey({ code: "KR042" })).toBe("billingLimit");
    expect(workspaceErrorKey({ code: "KR043" })).toBe("billingReadOnly");
    expect(workspaceErrorKey({ code: "KR044" })).toBe("templatesNotIncluded");
  });

  it("tells billing refusals apart", () => {
    expect(["KR040", "KR041", "KR042", "KR043", "KR044"].every((code) => isBillingError({ code }))).toBe(
      true,
    );
    expect(isBillingError({ code: "KR020" })).toBe(false);
    expect(isBillingError({ code: "42501" })).toBe(false);
    expect(isBillingError(null)).toBe(false);
  });

  it("maps permission and validation errors", () => {
    expect(workspaceErrorKey({ code: "42501" })).toBe("forbidden");
    expect(workspaceErrorKey({ code: "22023" })).toBe("invalidInput");
    expect(workspaceErrorKey({ code: "23514" })).toBe("invalidInput");
  });

  it("falls back to a generic message", () => {
    expect(workspaceErrorKey({ code: "XX000" })).toBe("generic");
    expect(workspaceErrorKey(null)).toBe("generic");
  });
});
