import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // `next dev` otherwise persists Turbopack's work in .next/dev/cache and it
    // grows by gigabytes; production uses `next build` + `next start` anyway.
    turbopackFileSystemCacheForDev: false,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_URL ?? "http://127.0.0.1:3001"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
