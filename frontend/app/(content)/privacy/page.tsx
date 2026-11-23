import type { Metadata } from "next";

import { ContentPage, ContentSection } from "@/components/shell/content-page";

export const metadata: Metadata = { title: "Privacy · CommerceLab" };

export default function PrivacyPage() {
  return (
    <ContentPage title="Privacy" intro="What we keep when you order, what we never see, and who to ask.">
      <ContentSection title="What we store">
        <p>When you place an order we keep what we need to fulfil it and to look after it afterwards:</p>
        <ul>
          <li>your contact details: name, email address and phone number</li>
          <li>your delivery address, and your company name and VAT number if you gave them</li>
          <li>your order: the items, their prices at the time, the total and the VAT</li>
          <li>the outcome of your payment: whether it succeeded, was declined or is still being confirmed</li>
        </ul>
        <p>We use these details to process your order, to show it to you on your order page, and to answer you if you write to us.</p>
      </ContentSection>

      <ContentSection title="Your card details">
        <p>
          Card details never reach CommerceLab. The card number, expiry date and security code you type are checked in
          your browser and are not sent to our servers or stored by us. We only receive the amount to be charged and
          the result.
        </p>
      </ContentSection>

      <ContentSection title="Your bag">
        <p>
          Your bag is kept in your own browser so it&apos;s still there when you come back. It isn&apos;t sent to us
          until you ask for a price check or place an order, and we don&apos;t use it to follow you around.
        </p>
      </ContentSection>

      <ContentSection title="Your order page">
        <p>
          Your order page is reached by a private link that only you have. Anyone with the link can see the order, so
          keep it to yourself.
        </p>
      </ContentSection>

      <ContentSection title="Photography">
        <p>
          Product photographs come from Unsplash and Pexels photographers under those sites&apos; licences. We record
          the photographer&apos;s credit and licence for each photograph.
        </p>
      </ContentSection>

      <ContentSection title="Your rights">
        <p>
          You can ask us what we hold about you, to correct it, or to delete it where we&apos;re allowed to. Write to{" "}
          <a href="mailto:hello@commercelab.example">hello@commercelab.example</a>.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
