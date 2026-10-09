import type { NextConfig } from "next";
import { redirects } from "./redirects";

const nextConfig: NextConfig = {
  redirects: async () => redirects,
  serverExternalPackages: ["@react-pdf/renderer"],
  // The gift card PDF reads the brand images from public/brand at runtime.
  outputFileTracingIncludes: {
    "/api/stripe/webhook": ["./public/brand/**"],
    "/api/cron/gift-delivery": ["./public/brand/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
