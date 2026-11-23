import { describe, expect, test } from "vitest";

import { cn } from "./utils";

describe("cn knows direction A's tokens", () => {
  test("a type size does not knock out a text colour", () => {
    expect(cn("text-white text-callout")).toBe("text-white text-callout");
    expect(cn("text-body text-ink")).toBe("text-body text-ink");
  });

  test("conflicting sizes, radii and tracking still merge", () => {
    expect(cn("text-headline text-title-1")).toBe("text-title-1");
    expect(cn("rounded-pill rounded-tile")).toBe("rounded-tile");
    expect(cn("tracking-headline tracking-tight")).toBe("tracking-tight");
    expect(cn("bg-accent bg-surface")).toBe("bg-surface");
  });
});
