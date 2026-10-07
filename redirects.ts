const EVENT = "/events/2026-10-04-strong-body-calm-mind";

type Redirect = { source: string; destination: string; statusCode: 301 };
const r = (source: string, destination: string): Redirect => ({ source, destination, statusCode: 301 });

/** Old Squarespace URLs, permanently redirected (spec section 4). First match wins, so specific paths come first. */
export const redirects: Redirect[] = [
  r("/ef-zin-retreats-1", "/events"),
  r("/ef-zin-retreats", "/retreats"),
  r("/past-events", "/events"),
  r("/past-retreats", "/retreats"),
  r("/forms", "/bespoke"),
  r("/interestform", "/bespoke?type=retreat_interest"),
  r("/store/p/strongbody-calmmind-re", EVENT),
  r("/store/p/strongbody-calmmind-re-k2dhd", EVENT),
  r("/store/p/:path*", "/events"),
  r("/privacy-policy-1", "/privacy"),
  r("/privacy-policy-1-1", "/privacy"),
  r("/faqs", "/faq"),
];