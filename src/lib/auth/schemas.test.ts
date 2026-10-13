import { z } from "zod";
import { describe, expect, it } from "vitest";
import { emailSchema, fieldErrors, newPasswordSchema } from "./schemas";

describe("emailSchema", () => {
  it("trims and lowercases", () => {
    expect(emailSchema.parse("  Aicha.Kossou@Exemple.BJ ")).toBe("aicha.kossou@exemple.bj");
  });

  it("rejects an invalid address with the emailInvalid key", () => {
    expect(emailSchema.safeParse("pas-une-adresse").error?.issues[0]?.message).toBe("emailInvalid");
  });
});

describe("newPasswordSchema", () => {
  it("needs 8 to 72 characters", () => {
    expect(newPasswordSchema.safeParse("1234567").success).toBe(false);
    expect(newPasswordSchema.safeParse("12345678").success).toBe(true);
    expect(newPasswordSchema.safeParse("x".repeat(73)).error?.issues[0]?.message).toBe("passwordTooLong");
  });
});

describe("fieldErrors", () => {
  it("keeps the first error of each field", () => {
    const schema = z.object({ email: emailSchema, password: newPasswordSchema });
    const result = schema.safeParse({ email: "x", password: "court" });
    expect(result.success).toBe(false);
    expect(fieldErrors(result.error!)).toEqual({ email: "emailInvalid", password: "passwordTooShort" });
  });
});
