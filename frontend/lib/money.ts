// Display only. Money arrives from the API as a decimal string ("119.00"), already
// computed by the backend; the frontend never does arithmetic on it.
//
// The string is passed to Intl as a string, so it is formatted exactly as sent,
// with no trip through a floating-point number.

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

const DECIMAL = /^-?\d+(\.\d+)?$/;

export function formatGBP(amount: string): string {
  if (!DECIMAL.test(amount)) {
    throw new TypeError(`formatGBP expects a decimal string such as "119.00", got ${JSON.stringify(amount)}`);
  }
  return GBP.format(amount as Intl.StringNumericLiteral);
}
