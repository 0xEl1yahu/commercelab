// The checkout form: its fields, the convenience checks run before Pay, and the
// request body built from it.
//
// The patterns are copied exactly from the backend (commercelab/api/models.py:
// ContactIn and AddressIn, both with str_strip_whitespace), which validates again;
// `checkout-schema.test.ts` holds a table of results taken from Pydantic itself.
// `z.email()` is deliberately not used: its rules differ from the backend's.
//
// Card details are checked here and nowhere else. They are not part of
// CheckoutForm, and toCheckoutRequest copies named fields only, so no card value
// can reach a request body.

import { z } from "zod";

import type { CartLine } from "./cart";
import type { CheckoutRequest } from "./types";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^[0-9 +()-]{7,20}$/;
const POSTCODE = /^[A-Za-z0-9 ]{5,8}$/;
const EXPIRY = /^(\d{2})\s*\/\s*(\d{2})$/;

/** What the shopper types for contact and delivery. Every value is the raw input. */
export type CheckoutForm = {
  email: string;
  name: string;
  phone: string;
  company: string;
  vat_number: string;
  line1: string;
  line2: string;
  city: string;
  postcode: string;
};

/** The card fields. Validated in the browser, never sent anywhere. */
export type CardForm = { number: string; expiry: string; securityCode: string };

export type CheckoutField = keyof CheckoutForm | keyof CardForm;

export const EMPTY_CHECKOUT_FORM: CheckoutForm = {
  email: "",
  name: "",
  phone: "",
  company: "",
  vat_number: "",
  line1: "",
  line2: "",
  city: "",
  postcode: "",
};

export const EMPTY_CARD_FORM: CardForm = { number: "", expiry: "", securityCode: "" };

/** Form order, for focusing the first field that needs attention. */
export const FIELD_ORDER: CheckoutField[] = [
  "email",
  "name",
  "phone",
  "company",
  "vat_number",
  "line1",
  "line2",
  "city",
  "postcode",
  "number",
  "expiry",
  "securityCode",
];

const TOO_LONG = "Keep this under 100 characters.";

/** The message for a field the server rejected (a 422 list names the field, not why in plain words). */
export const INVALID_FIELD_MESSAGE: Record<keyof CheckoutForm, string> = {
  email: "Enter a valid email address.",
  name: "Enter your full name.",
  phone: "Enter a valid phone number.",
  company: TOO_LONG,
  vat_number: TOO_LONG,
  line1: "Enter the first line of your address.",
  line2: TOO_LONG,
  city: "Enter a town or city.",
  postcode: "Enter a UK postcode.",
};

const optional = z.string().trim().max(100, TOO_LONG);

export const checkoutFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .max(254, INVALID_FIELD_MESSAGE.email)
    .regex(EMAIL, INVALID_FIELD_MESSAGE.email),
  name: z.string().trim().min(1, "Enter your full name.").max(100, TOO_LONG),
  phone: z
    .string()
    .trim()
    .min(1, "Enter your phone number.")
    .regex(PHONE, INVALID_FIELD_MESSAGE.phone),
  company: optional,
  vat_number: optional,
  line1: z.string().trim().min(1, INVALID_FIELD_MESSAGE.line1).max(100, TOO_LONG),
  line2: optional,
  city: z.string().trim().min(1, INVALID_FIELD_MESSAGE.city).max(100, TOO_LONG),
  postcode: z.string().trim().min(1, INVALID_FIELD_MESSAGE.postcode).regex(POSTCODE, INVALID_FIELD_MESSAGE.postcode),
});

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export const cardSchema = z.object({
  number: z.string().superRefine((value, ctx) => {
    const digits = value.replace(/ /g, "");
    if (digits === "") {
      ctx.addIssue({ code: "custom", message: "Enter your card number." });
    } else if (!/^\d{12,19}$/.test(digits) || !passesLuhn(digits)) {
      ctx.addIssue({ code: "custom", message: "Check your card number." });
    }
  }),
  expiry: z.string().superRefine((value, ctx) => {
    const trimmed = value.trim();
    if (trimmed === "") {
      ctx.addIssue({ code: "custom", message: "Enter the expiry date." });
      return;
    }
    const match = EXPIRY.exec(trimmed);
    const month = match ? Number(match[1]) : 0;
    if (!match || month < 1 || month > 12) {
      ctx.addIssue({ code: "custom", message: "Enter the expiry date as MM / YY." });
      return;
    }
    // A card works until the end of its expiry month.
    const now = new Date();
    const year = 2000 + Number(match[2]);
    if (year * 12 + month < now.getFullYear() * 12 + now.getMonth() + 1) {
      ctx.addIssue({ code: "custom", message: "This card has expired." });
    }
  }),
  securityCode: z.string().superRefine((value, ctx) => {
    const trimmed = value.trim();
    if (trimmed === "") ctx.addIssue({ code: "custom", message: "Enter the security code." });
    else if (!/^\d{3,4}$/.test(trimmed)) {
      ctx.addIssue({ code: "custom", message: "Enter the 3 or 4 digits on your card." });
    }
  }),
});

export type FieldErrors = Partial<Record<CheckoutField, string>>;

function firstIssues(issues: z.core.$ZodIssue[], into: FieldErrors): void {
  for (const issue of issues) {
    const field = issue.path[0] as CheckoutField | undefined;
    if (field !== undefined && into[field] === undefined) into[field] = issue.message;
  }
}

/** Checks every field; on failure, one message per field (the first problem found). */
export function validateCheckout(
  form: CheckoutForm,
  card: CardForm,
): { ok: true } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const details = checkoutFormSchema.safeParse(form);
  if (!details.success) firstIssues(details.error.issues, errors);
  const payment = cardSchema.safeParse(card);
  if (!payment.success) firstIssues(payment.error.issues, errors);
  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors };
}

/** Checks one field, for re-checking as the shopper corrects it. */
export function validateField(field: CheckoutField, form: CheckoutForm, card: CardForm): string | undefined {
  const result = validateCheckout(form, card);
  return result.ok ? undefined : result.errors[field];
}

/**
 * The POST /checkout body. Every string is trimmed; empty optional fields are left
 * out. Only the named contact and address fields are copied: card values are never
 * included, even if they were mixed into `form`.
 */
export function toCheckoutRequest(form: CheckoutForm, lines: CartLine[]): CheckoutRequest {
  const address: CheckoutRequest["address"] = {
    line1: form.line1.trim(),
    city: form.city.trim(),
    postcode: form.postcode.trim(),
    country: "GB",
  };
  const line2 = form.line2.trim();
  const company = form.company.trim();
  const vat_number = form.vat_number.trim();
  if (line2) address.line2 = line2;
  if (company) address.company = company;
  if (vat_number) address.vat_number = vat_number;

  return {
    contact: { email: form.email.trim(), name: form.name.trim(), phone: form.phone.trim() },
    address,
    items: lines.map(({ product_id, quantity }) => ({ product_id, quantity })),
  };
}

// --- input formatting (display only) --------------------------------------------

/** Digits only, at most 19, in groups of four: "4242 4242 4242 4242". */
export function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 19);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** "MM / YY" as it is typed: "0830" gives "08 / 30", "08" stays "08". */
export function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)} / ${digits.slice(2)}` : digits;
}

/** Digits only, at most 4. */
export function formatSecurityCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 4);
}
