import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.CLOAK_TEST_OUTPUT === "true" ? ".next-test" : ".next",
  turbopack: { root: process.cwd() },
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
      ],
    }];
  },
};

export default nextConfig;
