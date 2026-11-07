import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Dockerfile sets NEXT_OUTPUT=standalone. Vercel and `pnpm dev` leave it unset.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  cacheComponents: true,
  // The form filler's files, which its download route zips up, and the
  // fonts the Inngest steps draw CVs and letters with.
  outputFileTracingIncludes: {
    "/api/extension/download": ["./extension/**/*"],
    "/api/inngest": ["./lib/documents/fonts/*.ttf"],
  },
  partialPrefetching: true,
  // On every response: no other site can show the app in a frame (where a
  // page could trick the owner into clicking its buttons), and a link to an
  // employer's site doesn't tell them the app's address.
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  // The inbox is gone: the app sorts new matches itself.
  redirects() {
    return [{ source: "/inbox", destination: "/jobs", permanent: false }];
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
