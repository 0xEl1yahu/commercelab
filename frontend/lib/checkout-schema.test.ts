import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_CHECKOUT_FORM,
  cardSchema,
  checkoutFormSchema,
  formatCardNumber,
  formatExpiry,
  formatSecurityCode,
  toCheckoutRequest,
  validateCheckout,
  type CardForm,
  type CheckoutForm,
} from "./checkout-schema";

const FORM: CheckoutForm = {
  email: "sam.okafor@northfold.co.uk",
  name: "Sam Okafor",
  phone: "07700 900412",
  company: "Northfold Studio Ltd",
  vat_number: "",
  line1: "14 Albion Street",
  line2: "",
  city: "Leeds",
  postcode: "LS1 6HX",
};

const CARD: CardForm = { number: "4242 4242 4242 4242", expiry: "08 / 30", securityCode: "123" };

const LINES = [{ product_id: 7, quantity: 2 }];

afterEach(() => {
  vi.useRealTimers();
});

describe("toCheckoutRequest", () => {
  it("toCheckoutRequest never contains card fields", () => {
    // Even when card values are mixed into the form object by mistake.
    const leaky = { ...FORM, ...CARD, cardNumber: CARD.number, cvc: "123" } as unknown as CheckoutForm;
    const body = toCheckoutRequest(leaky, LINES);
    const json = JSON.stringify(body);
    expect(json).not.toContain("4242");
    expect(json).not.toContain("08 / 30");
    expect(json).not.toMatch(/number|expiry|security|cvc|card/i);
    expect(Object.keys(body).sort()).toEqual(["address", "contact", "items"]);
    expect(Object.keys(body.contact).sort()).toEqual(["email", "name", "phone"]);
  });

  it("omits empty optional address fields", () => {
    const body = toCheckoutRequest({ ...FORM, company: "   ", vat_number: "", line2: "" }, LINES);
    expect(body.address).toEqual({
      line1: "14 Albion Street",
      city: "Leeds",
      postcode: "LS1 6HX",
      country: "GB",
    });
    expect("line2" in body.address).toBe(false);
    expect("company" in body.address).toBe(false);
    expect("vat_number" in body.address).toBe(false);
  });

  it("keeps filled optional fields, trimmed", () => {
    const body = toCheckoutRequest({ ...FORM, line2: " Floor 2 ", vat_number: " GB123456789 " }, LINES);
    expect(body.address.line2).toBe("Floor 2");
    expect(body.address.vat_number).toBe("GB123456789");
    expect(body.address.company).toBe("Northfold Studio Ltd");
  });

  it("trims the email", () => {
    const body = toCheckoutRequest({ ...FORM, email: "  sam.okafor@northfold.co.uk \n" }, LINES);
    expect(body.contact.email).toBe("sam.okafor@northfold.co.uk");
  });

  it("sends the bag lines as items, product_id and quantity only", () => {
    const lines = [{ product_id: 3, quantity: 1, extra: true } as unknown as (typeof LINES)[number]];
    expect(toCheckoutRequest(FORM, lines).items).toEqual([{ product_id: 3, quantity: 1 }]);
  });
});

describe("cardSchema", () => {
  it("accepts 4242 4242 4242 4242", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
    expect(cardSchema.safeParse(CARD).success).toBe(true);
  });

  it("rejects a bad Luhn", () => {
    const result = cardSchema.safeParse({ ...CARD, number: "4242 4242 4242 4241" });
    expect(result.success).toBe(false);
  });

  it("rejects a past expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
    expect(cardSchema.safeParse({ ...CARD, expiry: "10 / 26" }).success).toBe(false);
    expect(cardSchema.safeParse({ ...CARD, expiry: "12 / 25" }).success).toBe(false);
    // The card works until the end of its expiry month.
    expect(cardSchema.safeParse({ ...CARD, expiry: "11 / 26" }).success).toBe(true);
  });

  it("rejects malformed expiries, numbers and security codes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
    for (const expiry of ["13 / 30", "00 / 30", "8 / 30", "08 / 2030", "0830x"]) {
      expect(cardSchema.safeParse({ ...CARD, expiry }).success, expiry).toBe(false);
    }
    expect(cardSchema.safeParse({ ...CARD, expiry: "08/30" }).success).toBe(true);
    expect(cardSchema.safeParse({ ...CARD, number: "4242 4242 42" }).success).toBe(false);
    expect(cardSchema.safeParse({ ...CARD, number: "4242-4242-4242-4242" }).success).toBe(false);
    expect(cardSchema.safeParse({ ...CARD, securityCode: "12" }).success).toBe(false);
    expect(cardSchema.safeParse({ ...CARD, securityCode: "12a" }).success).toBe(false);
    expect(cardSchema.safeParse({ ...CARD, securityCode: "1234" }).success).toBe(true);
  });
});

describe("checkoutFormSchema", () => {
  // Expected results copied from the backend: commercelab/api/models.py ContactIn and
  // AddressIn (str_strip_whitespace=True), run through Pydantic.
  const EMAILS: [string, boolean][] = [
    ["sam@northfold.co.uk", true],
    ["  sam@northfold.co.uk  ", true],
    ["a@b.c", true],
    ["sam@northfold", false],
    ["sam okafor@northfold.co.uk", false],
    ["sam@@northfold.co.uk", false],
  ];
  const PHONES: [string, boolean][] = [
    ["07700 900412", true],
    ["+44 (0)7700-900412", true],
    ["123456", false],
    ["0770O 900412", false],
  ];
  const POSTCODES: [string, boolean][] = [
    ["LS1 6HX", true],
    ["ls16hx", true],
    ["LS1-6HX", false],
    ["SW1A  1AA", false],
  ];

  it("patterns match the backend", () => {
    for (const [email, ok] of EMAILS) {
      expect(checkoutFormSchema.safeParse({ ...FORM, email }).success, email).toBe(ok);
    }
    for (const [phone, ok] of PHONES) {
      expect(checkoutFormSchema.safeParse({ ...FORM, phone }).success, phone).toBe(ok);
    }
    for (const [postcode, ok] of POSTCODES) {
      expect(checkoutFormSchema.safeParse({ ...FORM, postcode }).success, postcode).toBe(ok);
    }
  });

  it("requires name, line 1 and town after trimming, and caps lengths", () => {
    expect(checkoutFormSchema.safeParse({ ...FORM, name: "   " }).success).toBe(false);
    expect(checkoutFormSchema.safeParse({ ...FORM, line1: "" }).success).toBe(false);
    expect(checkoutFormSchema.safeParse({ ...FORM, city: " " }).success).toBe(false);
    expect(checkoutFormSchema.safeParse({ ...FORM, name: "x".repeat(101) }).success).toBe(false);
    expect(checkoutFormSchema.safeParse({ ...FORM, company: "x".repeat(101) }).success).toBe(false);
    expect(checkoutFormSchema.safeParse({ ...FORM, email: `${"x".repeat(250)}@b.co` }).success).toBe(
      false,
    );
  });
});

describe("input formatting", () => {
  it("groups card digits in fours and drops anything else", () => {
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
    expect(formatCardNumber("4242-4242 42x")).toBe("4242 4242 42");
    expect(formatCardNumber("1".repeat(25)).replace(/ /g, "")).toHaveLength(19);
  });

  it("writes the expiry as MM / YY while typing", () => {
    expect(formatExpiry("08")).toBe("08");
    expect(formatExpiry("083")).toBe("08 / 3");
    expect(formatExpiry("08 / 30")).toBe("08 / 30");
    expect(formatExpiry("08/301")).toBe("08 / 30");
  });

  it("keeps at most four security code digits", () => {
    expect(formatSecurityCode("12a34 5")).toBe("1234");
  });
});

describe("validateCheckout", () => {
  it("returns one message per invalid field, keyed by field name", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
    const result = validateCheckout(EMPTY_CHECKOUT_FORM, { number: "", expiry: "", securityCode: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      ["city", "email", "expiry", "line1", "name", "number", "phone", "postcode", "securityCode"].sort(),
    );
    for (const message of Object.values(result.errors)) expect(message).toMatch(/\.$/);
  });

  it("passes a complete form", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
    expect(validateCheckout(FORM, CARD)).toEqual({ ok: true });
  });
});
