import type { Metadata } from "next";

import { ContentPage, ContentSection } from "@/components/shell/content-page";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <ContentPage title="Contact" intro="Questions about an order, a return or a product? Write to us and we'll reply.">
      <ContentSection title="Email">
        <p>
          <a href="mailto:hello@commercelab.example">hello@commercelab.example</a>
        </p>
        <p>Please include your order reference if you&apos;re asking about an order. It looks like CL-00042 and is shown on your order page.</p>
      </ContentSection>

      <ContentSection title="Address">
        <address className="not-italic">
          CommerceLab Ltd
          <br />
          Unit 4, 21 Canal Wharf, Leeds LS11 5PS
        </address>
        <p>Please write before sending anything to this address. Returns are arranged by email first.</p>
      </ContentSection>

      <ContentSection title="Company details">
        <p>
          CommerceLab Ltd. Registered in England 15482931. VAT GB 482 1937 55.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
