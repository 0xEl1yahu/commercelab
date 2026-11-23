import type { Metadata } from "next";

import { ContentPage, ContentSection } from "@/components/shell/content-page";

export const metadata: Metadata = { title: "Delivery & returns · CommerceLab" };

export default function DeliveryReturnsPage() {
  return (
    <ContentPage
      title="Delivery & returns"
      intro="Free delivery to every UK address, a month to change your mind, and two years of cover on everything we sell."
    >
      <ContentSection title="Delivery">
        <p>
          Free UK delivery on every order. There is no minimum spend, and the price you see at checkout is the price
          you pay.
        </p>
        <p>
          We don&apos;t promise delivery dates. Every order is packed and sent as soon as we can, and we would rather
          say nothing than name a day we might miss. Your order page shows what we know about your order, and you can
          return to it at any time using the link you were given after paying.
        </p>
        <p>We deliver to UK addresses only.</p>
      </ContentSection>

      <ContentSection title="Returns">
        <p>
          You have 30 days from receiving your order to send anything back. Items must be unused and in their original
          packaging, with everything that came in the box.
        </p>
        <p>
          To start a return, write to <a href="mailto:hello@commercelab.example">hello@commercelab.example</a> with
          your order reference and the items you&apos;re sending back. We&apos;ll tell you where to send them.
        </p>
        <p>
          Once your return reaches us and we&apos;ve checked it, we&apos;ll refund the price you paid for those
          items.
        </p>
      </ContentSection>

      <ContentSection title="Warranty">
        <p>
          Every product carries a 2-year warranty from the brand that makes it. If something develops a fault through
          normal use, get in touch and we&apos;ll help you take it up with the brand.
        </p>
        <p>
          The warranty doesn&apos;t cover accidental damage or wear from ordinary use, and it sits alongside your
          statutory rights, which these terms don&apos;t affect.
        </p>
      </ContentSection>

      <ContentSection title="Faulty or wrong item">
        <p>
          If something arrives damaged or isn&apos;t what you ordered, write to us as soon as you can with your order
          reference and a photo, at{" "}
          <a href="mailto:hello@commercelab.example">hello@commercelab.example</a>.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
