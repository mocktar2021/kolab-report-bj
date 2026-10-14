// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { passwordFields } from "../../../scripts/supabase-auth-settings.mjs";
import { hasLetterAndDigit, PASSWORD_MIN_LENGTH, passwordBytes } from "./password-policy";

// Supabase Auth's check: one character of each ":" separated set.
function supabaseAccepts(password: string, requiredCharacters: string) {
  return requiredCharacters
    .split(":")
    .filter(Boolean)
    .every((set) => [...password].some((char) => set.includes(char)));
}

describe("password policy", () => {
  it("matches supabase/config.toml, which the hosted projects get", async () => {
    const fields = passwordFields(await readFile("supabase/config.toml", "utf8"));
    expect(fields.password_min_length).toBe(PASSWORD_MIN_LENGTH);
    for (const password of [
      "chaufferie2026",
      "0197123456",
      "motdepasse",
      "Kolab-test-2026",
      "élève-2026",
      "éèà1",
    ]) {
      expect(hasLetterAndDigit(password), password).toBe(
        supabaseAccepts(password, fields.password_required_characters),
      );
    }
  });

  it("counts bytes like bcrypt", () => {
    expect(passwordBytes("abc")).toBe(3);
    expect(passwordBytes("é")).toBe(2);
  });
});
