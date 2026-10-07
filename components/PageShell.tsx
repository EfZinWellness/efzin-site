import Image from "next/image";
import { photo } from "@/lib/images";

export default function PageShell({
  title,
  greek,
  image,
  imageAlt,
  children,
}: {
  title: string;
  greek?: string;
  image?: string;
  imageAlt?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-2xl px-6 py-16">
      <header className="text-center">
        {greek ? <p className="greek text-base">{greek}</p> : null}
        <h1 className="mt-2 font-serif text-4xl leading-tight">{title}</h1>
      </header>
      {image ? (
        <div className="relative mx-auto mt-10 aspect-[4/5] max-w-sm bg-sand/40">
          <Image src={photo(image, 1000)} alt={imageAlt ?? ""} fill sizes="(min-width: 640px) 384px, 100vw" className="object-cover" />
        </div>
      ) : null}
      <div>{children}</div>
    </article>
  );
}