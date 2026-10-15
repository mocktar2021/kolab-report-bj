import { describe, expect, it } from "vitest";
import { billingDetailsErrors, billingDetailsSchema } from "./details";

describe("billingDetailsSchema", () => {
  it("trims the fields, lowers the e-mail and clears empty ones", () => {
    expect(
      billingDetailsSchema.parse({
        legalName: "  Cabinet Dossou   SARL ",
        address: "Rue 12\nCotonou",
        taxId: "",
        billingEmail: " Compta@Dossou.BJ ",
      }),
    ).toEqual({
      legalName: "Cabinet Dossou SARL",
      address: "Rue 12 Cotonou",
      taxId: null,
      billingEmail: "compta@dossou.bj",
    });
    expect(
      billingDetailsSchema.parse({ legalName: null, address: null, taxId: null, billingEmail: null }),
    ).toEqual({
      legalName: null,
      address: null,
      taxId: null,
      billingEmail: null,
    });
  });

  it("gives one message key per field, matching the database checks", () => {
    const result = billingDetailsSchema.safeParse({
      legalName: "A",
      address: "x".repeat(501),
      taxId: "IFU <script>",
      billingEmail: "compta@",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(billingDetailsErrors(result.error)).toEqual({
      legalName: "legalNameLength",
      address: "addressLength",
      taxId: "taxIdInvalid",
      billingEmail: "emailInvalid",
    });
  });

  it("takes the IFU of Benin and the tax ids of other countries", () => {
    expect(billingDetailsSchema.shape.taxId.parse("3201912345678")).toBe("3201912345678");
    expect(billingDetailsSchema.shape.taxId.parse("CI-1234567 X")).toBe("CI-1234567 X");
    expect(billingDetailsSchema.shape.taxId.safeParse("1".repeat(41)).success).toBe(false);
  });
});
