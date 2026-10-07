import type { Metadata } from "next";
import { Playfair_Display, Montserrat, Noto_Serif_Display } from "next/font/google";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import PriceTag from "@/components/PriceTag";
import { BookPanelProvider, type PanelItem } from "@/components/BookPanel";
import { loadExperiences, upcoming } from "@/lib/content/load";
import { getSpotsLeftMany, minSpots } from "@/lib/booking/availability";
import { spotsLeftLabel } from "@/lib/booking/spots";
import { bookHref, formatWhen, headlinePrice } from "@/lib/format";
import { getPricingContext } from "@/lib/pricing/context";
import { ratesSubset } from "@/lib/pricing/visitor";
import "./globals.css";

const serif = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
});

const sans = Montserrat({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

const greek = Noto_Serif_Display({
  variable: "--font-greek",
  subsets: ["greek", "latin"],
  weight: ["300"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Ef Zin Wellness",
  description: "Ef Zin wellness events, retreats, bespoke experiences and coaching.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const now = new Date();
  const bookable = upcoming(await loadExperiences(), now)
    .filter((e) => e.status === "on_sale")
    .slice(0, 4);
  const { visitorCurrency, rates } = await getPricingContext();
  const spots = await getSpotsLeftMany(bookable.map((e) => e.slug));
  const items: PanelItem[] = await Promise.all(
    bookable.map(async (e) => {
      const price = headlinePrice(e);
      return {
        slug: e.slug,
        title: e.title,
        when: formatWhen(e),
        href: bookHref(e.slug),
        price:
          price === null ? null : (
            <PriceTag
              baseMinor={price}
              baseCurrency={e.baseCurrency}
              visitorCurrency={visitorCurrency}
              rates={ratesSubset(rates, [e.baseCurrency, visitorCurrency])}
            />
          ),
        spotsLabel: spotsLeftLabel(minSpots(spots?.[e.slug])),
      };
    }),
  );

  return (
    <html
      lang="en"
      className={`${serif.variable} ${sans.variable} ${greek.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <BookPanelProvider items={items}>
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
        </BookPanelProvider>
      </body>
    </html>
  );
}
