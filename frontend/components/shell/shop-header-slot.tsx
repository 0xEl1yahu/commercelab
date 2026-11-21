"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Picks the header for the current route: `checkout` (<SiteHeader variant="checkout" />)
 * on /checkout, `shop` (<SiteHeader />) everywhere else. app/layout.tsx mounts it once,
 * outside <main>, so the header is always the page's banner landmark: pages never
 * render a header. (A route group can't do this: every route sits directly under app/.)
 */
export function ShopHeaderSlot({ shop, checkout }: { shop: ReactNode; checkout: ReactNode }) {
  const pathname = usePathname();
  const onCheckout = pathname === "/checkout" || pathname?.startsWith("/checkout/");
  return onCheckout ? checkout : shop;
}
