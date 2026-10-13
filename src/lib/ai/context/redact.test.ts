import { describe, expect, it } from "vitest";
import { PII_PLACEHOLDERS, redactPii } from "./redact";

describe("redactPii", () => {
  it("masks e-mail addresses, escaped Markdown included", () => {
    const result = redactPii("Écrire à jean.dupont@exemple.fr ou à marie\\_k+audit@cabinet.co.bj.");
    expect(result.text).toBe(`Écrire à ${PII_PLACEHOLDERS.email} ou à ${PII_PLACEHOLDERS.email}.`);
    expect(result.counts.email).toBe(2);
  });

  it.each([
    "06 12 34 56 78",
    "06.12.34.56.78",
    "06-12-34-56-78",
    "0612345678",
    "+33 6 12 34 56 78",
    "+33612345678",
    "+33 (0)1 23 45 67 89",
    "0033 6 12 34 56 78",
    "+229 01 97 00 00 00",
    "+229 97 00 00 00",
    "+229 0197000000",
  ])("masks the phone number %s", (phone) => {
    const result = redactPii(`Tél. : ${phone}, bureau.`);
    expect(result.text).toBe(`Tél. : ${PII_PLACEHOLDERS.phone}, bureau.`);
    expect(result.counts.phone).toBe(1);
  });

  it.each([
    "FR76 3000 6000 0112 3456 7890 189",
    "FR7630006000011234567890189",
    "DE89 3704 0044 0532 0130 00",
    "GB82 WEST 1234 5698 7654 32",
  ])("masks the IBAN %s", (iban) => {
    const result = redactPii(`IBAN : ${iban} (compte courant)`);
    expect(result.text).toBe(`IBAN : ${PII_PLACEHOLDERS.iban} (compte courant)`);
    expect(result.counts.iban).toBe(1);
  });

  it("keeps an uppercase word glued after an IBAN", () => {
    expect(redactPii("DE89 3704 0044 0532 0130 00 EUR").text).toBe(`${PII_PLACEHOLDERS.iban} EUR`);
  });

  it.each(["1 85 05 78 006 084 36", "185057800608436", "2 85 05 2A 006 084 36", "1 85 05 971 12 084 36"])(
    "masks the social security number %s",
    (nir) => {
      const result = redactPii(`NIR ${nir}.`);
      expect(result.text).toBe(`NIR ${PII_PLACEHOLDERS.nir}.`);
      expect(result.counts.nir).toBe(1);
    },
  );

  it.each(["4111 1111 1111 1111", "4111-1111-1111-1111", "4111111111111111", "3782 822463 10005"])(
    "masks the card number %s",
    (card) => {
      const result = redactPii(`Carte ${card} expirée`);
      expect(result.text).toBe(`Carte ${PII_PLACEHOLDERS.card} expirée`);
      expect(result.counts.card).toBe(1);
    },
  );

  it.each([
    "En 2023, le budget était de 1 250 000 € (+12,5 %).",
    "Réunion du 01/02/2023, puis du 01.02.2023 12 h.",
    "Le 2023-10-13 à 10:00, 45 % des 1 200 dossiers.",
    "SIRET 73282932000074 et 732 829 320 00074, SIREN 732 829 320.",
    "Années 2021 2022 2023 2024 et 1990 1991 1992 1993.",
    "Carte 4111 1111 1111 1112 refusée, référence 4111111111111112.",
    "IBAN FR76 3000 6000 0112 3456 7890 188 erroné.",
    "Montant 0 612 345 678 FCFA, code 1234567890123, lot 12345678901.",
    "| 2023 | 1 250 000 | 3 400 | 06 |",
    "Version 1.2.3, ISO 27001, norme NF C 15-100.",
  ])("leaves %s alone", (text) => {
    const result = redactPii(text);
    expect(result.text).toBe(text);
    expect(Object.values(result.counts).every((count) => count === 0)).toBe(true);
  });

  it("counts each kind", () => {
    const result = redactPii(
      "a@b.fr, c@d.com, 06 12 34 56 78, FR76 3000 6000 0112 3456 7890 189, 1 85 05 78 006 084 36, 4111 1111 1111 1111",
    );
    expect(result.counts).toEqual({ email: 2, phone: 1, iban: 1, nir: 1, card: 1 });
  });

  it("stays fast on 200 KB of digits and spaces", () => {
    let seed = 42;
    let text = "";
    while (text.length < 200_000) {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      text += String(seed % 10) + (seed % 7 === 0 ? " " : "");
    }
    const start = performance.now();
    redactPii(text);
    redactPii("1".repeat(200_000));
    redactPii("a".repeat(200_000));
    redactPii("a@".repeat(100_000));
    redactPii("FR76 ".repeat(40_000));
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
