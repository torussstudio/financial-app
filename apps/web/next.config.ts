import type { NextConfig } from "next";
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
];
const config: NextConfig = {
  async rewrites() { return [{ source: "/api/:path*", destination: (process.env.API_INTERNAL_URL || "http://127.0.0.1:4000") + "/api/:path*" }] },
  async headers() { return [{ source: "/:path*", headers: securityHeaders }] },
  poweredByHeader: false,
  compress: true,
  experimental: { optimizePackageImports: ["lucide-react", "recharts"] }
};
export default config;
