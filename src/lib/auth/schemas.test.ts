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
  const firstError = (password: string) => newPasswordSchema.safeParse(password).error?.issues[0]?.message;

  it("needs 10 characters", () => {
    expect(firstError("abcdef123")).toBe("passwordTooShort");
    expect(firstError("abcdefg123")).toBeUndefined();
  });

  it("needs a letter and a digit", () => {
    // A 10 digit phone number or a word alone is refused.
    expect(firstError("0197123456")).toBe("passwordNeedsLetterAndDigit");
    expect(firstError("motdepasse")).toBe("passwordNeedsLetterAndDigit");
    expect(firstError("rapport chaufferie 2")).toBeUndefined();
  });

  it("asks for no capital letter or symbol", () => {
    expect(firstError("chaufferie2026")).toBeUndefined();
  });

  it("accepts the e2e fixture passwords", () => {
    for (const password of ["Kolab-test-2026", "Nouveau-mdp-2026"]) {
      expect(newPasswordSchema.safeParse(password).success).toBe(true);
    }
  });

  it("counts accented letters as two bytes against the 72 byte limit", () => {
    expect(firstError(`a1${"x".repeat(70)}`)).toBeUndefined();
    expect(firstError(`a1${"x".repeat(71)}`)).toBe("passwordTooLong");
    expect(firstError(`a1${"é".repeat(36)}`)).toBe("passwordTooLong");
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
