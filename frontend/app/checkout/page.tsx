import type { Metadata } from "next";

import { CheckoutForm } from "@/components/checkout/checkout-form";

// The header is the layout's (ShopHeaderSlot picks the checkout header on
// /checkout), so the page renders only its content. Everything on it depends on
// the bag in localStorage, so CheckoutForm renders in the browser.
export const metadata: Metadata = {
  title: "Checkout – CommerceLab",
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return <CheckoutForm />;
}
