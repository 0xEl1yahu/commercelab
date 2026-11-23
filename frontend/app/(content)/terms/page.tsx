import type { Metadata } from "next";
import Link from "next/link";

import { ContentPage, ContentSection } from "@/components/shell/content-page";

export const metadata: Metadata = { title: "Terms · CommerceLab" };

export default function TermsPage() {
  return (
    <ContentPage
      title="Terms"
      intro="A plain-English summary of how buying from CommerceLab works. It doesn't affect your statutory rights."
    >
      <ContentSection title="Who we are">
        <p>
          CommerceLab Ltd sells keyboards, mice, monitors, audio and desk equipment to customers in the UK. Our details
          are on the contact page.
        </p>
      </ContentSection>

      <ContentSection title="Prices and VAT">
        <p>
          Prices are in pounds sterling and include VAT. The VAT in your order is shown on its confirmation page.
          Delivery within the UK is free.
        </p>
      </ContentSection>

      <ContentSection title="Placing an order">
        <p>
          When you pay, we reserve the items for you and take payment for the total shown. Stock is limited. If
          something sells out while you&apos;re checking out, we tell you before you pay and nothing is charged for it.
        </p>
        <p>
          If a payment is declined, you haven&apos;t been charged and your bag is kept. If we can&apos;t yet confirm a
          payment, your order page says so, and shows the result once the payment is confirmed.
        </p>
        <p>We don&apos;t send confirmation emails. Keep the link to your order page to check on it later.</p>
      </ContentSection>

      <ContentSection title="Delivery, returns and warranty">
        <p>
          Delivery is free within the UK, with no promised dates. You can return unused items in their original
          packaging within 30 days, and every product has a 2-year warranty from its brand. The details are on the{" "}
          <Link href="/delivery-returns">delivery and returns page</Link>.
        </p>
      </ContentSection>

      <ContentSection title="Product information">
        <p>
          We take care with descriptions, specifications and photographs, but a photo is a guide: colours on your
          screen and small details of a product can differ from what arrives.
        </p>
      </ContentSection>

      <ContentSection title="Questions">
        <p>
          Write to <a href="mailto:hello@commercelab.example">hello@commercelab.example</a> and we&apos;ll answer.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
