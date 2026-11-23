import type { ReactNode } from "react";

type Props = {
  title: string;
  /** One line under the title, in muted type. */
  intro?: string;
  children: ReactNode;
};

/**
 * A reading column for the footer's content pages: 680px, headline-style title,
 * then sections. Render <ContentSection> inside it for each titled block.
 * Pages render inside the layout's <main>, so this adds no landmarks of its own.
 */
export function ContentPage({ title, intro, children }: Props) {
  return (
    <article className="mx-auto w-full max-w-[680px] px-4 pt-14 pb-20 md:px-6 md:pt-20 md:pb-28">
      <h1 className="headline text-title-2 md:text-title-1">{title}</h1>
      {intro ? <p className="mt-4 text-body text-muted text-pretty">{intro}</p> : null}
      <div className="mt-12 flex flex-col gap-10">{children}</div>
    </article>
  );
}

export function ContentSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="headline text-title-3">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-body text-ink-2 text-pretty [&_a]:text-accent [&_a]:underline-offset-4 hover:[&_a]:underline [&_li]:pl-1 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
