"use client";

import { Button } from "@/components/ui/button";

/**
 * Shown when a page's data can't be loaded (the backend is down or errored). It
 * renders inside the layout's <main>; the header and footer stay. `reset` asks
 * Next to render the page again.
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="headline text-title-2 md:text-title-1">We can&apos;t load the shop right now.</h1>
      <p className="mt-4 text-body text-muted text-pretty">
        Nothing you&apos;ve added to your bag has been lost. Give it a moment, then try again.
      </p>
      <Button size="lg" className="mt-8" onClick={() => reset()}>
        Try again
      </Button>
    </section>
  );
}
