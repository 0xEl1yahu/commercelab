import { describe, expect, test } from "vitest";

import { stockLabel } from "./stock-badge";

describe("stockLabel", () => {
  test("labels each band", () => {
    expect(stockLabel("in_stock", null)).toBe("In stock");
    expect(stockLabel("low_stock", 2)).toBe("Only 2 left");
    expect(stockLabel("out_of_stock", null)).toBe("Out of stock");
  });

  test("low stock without a count reads In stock", () => {
    expect(stockLabel("low_stock", null)).toBe("In stock");
    expect(stockLabel("low_stock", undefined)).toBe("In stock");
  });
});
