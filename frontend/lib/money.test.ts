import { describe, expect, test } from "vitest";

import { formatGBP } from "./money";

describe("formatGBP", () => {
  test('"119.00" gives "£119.00"', () => {
    expect(formatGBP("119.00")).toBe("£119.00");
  });

  test('"0.00" gives "£0.00"', () => {
    expect(formatGBP("0.00")).toBe("£0.00");
  });

  test("groups thousands the UK way", () => {
    expect(formatGBP("1249.50")).toBe("£1,249.50");
  });

  test("keeps the pennies exactly as sent", () => {
    expect(formatGBP("19.83")).toBe("£19.83");
    expect(formatGBP("0.10")).toBe("£0.10");
  });

  test("refuses anything that is not a decimal string", () => {
    expect(() => formatGBP("")).toThrow();
    expect(() => formatGBP("£5")).toThrow();
    expect(() => formatGBP("1e3")).toThrow();
  });
});
