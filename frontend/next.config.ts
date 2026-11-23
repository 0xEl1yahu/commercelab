import type { NextConfig } from "next";

// The scaffold turned on cacheComponents and partialPrefetching. They are off here:
// every catalogue read is a request-time `no-store` fetch (stock and prices change),
// and under Cache Components each of those reads would need its own <Suspense>
// boundary. With the previous model a no-store fetch simply makes the route dynamic,
// and a failed read reaches app/error.tsx with a 500.
const nextConfig: NextConfig = {
  // Product photos are served already sized from /media/[key]; next/image is used
  // with `unoptimized`, so no image optimiser or remote patterns are needed.
  images: { unoptimized: true },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
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
