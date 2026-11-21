import Link from "next/link";

const PROMISES = [
  { title: "Free UK delivery", detail: "On every order, with no minimum spend." },
  { title: "30-day returns", detail: "Send back anything unused in its original packaging." },
  { title: "2-year warranty", detail: "On every product, from the brand that makes it." },
] as const;

const CONTENT_PAGES = [
  { href: "/delivery-returns", label: "Delivery & returns" },
  { href: "/contact", label: "Contact" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
] as const;

export const COMPANY_DETAILS =
  "CommerceLab Ltd · Unit 4, 21 Canal Wharf, Leeds LS11 5PS · Registered in England 15482931 · VAT GB 482 1937 55";

/** The three promise lines, links to the four content pages, and the company details. */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-surface text-caption text-muted">
      <div className="shop-container">
        <ul className="grid gap-6 border-b border-line py-10 sm:grid-cols-3 sm:gap-8">
          {PROMISES.map((promise) => (
            <li key={promise.title}>
              <p className="text-footnote font-semibold text-ink">{promise.title}</p>
              <p className="mt-1">{promise.detail}</p>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3 py-6">
          <nav aria-label="Shop information">
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {CONTENT_PAGES.map((page) => (
                <li key={page.href}>
                  <Link href={page.href} className="text-ink-2 transition-colors hover:text-ink hover:underline underline-offset-4">
                    {page.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p className="leading-relaxed">{COMPANY_DETAILS}</p>
        </div>
      </div>
    </footer>
  );
}
