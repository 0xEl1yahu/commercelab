import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import { BagDrawer } from "@/components/cart/bag-drawer";
import { CartProvider } from "@/components/cart/cart-provider";
import { ShopHeaderSlot } from "@/components/shell/shop-header-slot";
import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader } from "@/components/shell/site-header";

import "./globals.css";

// Inter, self-hosted from the @fontsource-variable/inter package (so builds need no
// network), as the fallback behind the Apple system font.
const inter = localFont({
  src: "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CommerceLab",
  description: "Keyboards, mice, monitors, audio and desk kit for better work. Free UK delivery.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

/**
 * Every page renders inside <main> here: pages don't add their own <main>, header
 * or footer. The bag drawer is mounted once, inside the cart provider.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB" className={`${inter.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <CartProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-pill focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
          >
            Skip to content
          </a>
          <ShopHeaderSlot>
            <SiteHeader />
          </ShopHeaderSlot>
          <main id="main" className="flex flex-1 flex-col">
            {children}
          </main>
          <SiteFooter />
          <BagDrawer />
        </CartProvider>
      </body>
    </html>
  );
}
