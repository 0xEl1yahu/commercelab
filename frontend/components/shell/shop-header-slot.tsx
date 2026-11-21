"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Renders the shop header everywhere except /checkout, which shows the minimal
 * <SiteHeader variant="checkout" /> from its own page instead. (A route group can't
 * do this here: every route sits directly under app/.)
 */
export function ShopHeaderSlot({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/checkout" || pathname?.startsWith("/checkout/")) return null;
  return children;
}
