import Link from "next/link";
import { MDXRemote } from "next-mdx-remote/rsc";
import type { ComponentProps } from "react";

const components = {
  h2: (p: ComponentProps<"h2">) => <h2 className="mt-12 font-serif text-2xl leading-snug" {...p} />,
  h3: (p: ComponentProps<"h3">) => <h3 className="mt-8 font-serif text-xl" {...p} />,
  p: (p: ComponentProps<"p">) => <p className="mt-4 text-sm leading-7 text-navy/90" {...p} />,
  ul: (p: ComponentProps<"ul">) => <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-7 text-navy/90" {...p} />,
  ol: (p: ComponentProps<"ol">) => <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-7 text-navy/90" {...p} />,
  strong: (p: ComponentProps<"strong">) => <strong className="font-medium text-navy" {...p} />,
  a: ({ href = "", ...p }: ComponentProps<"a">) =>
    href.startsWith("/") ? (
      <Link href={href} className="underline underline-offset-4" {...p} />
    ) : (
      <a href={href} className="underline underline-offset-4" {...p} />
    ),
};

/** HTML comments (e.g. the legal "Draft" marker) are valid in the source files but not in MDX. */
export function stripHtmlComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, "");
}

export default function Mdx({ source }: { source: string }) {
  return <MDXRemote source={stripHtmlComments(source)} components={components} />;
}