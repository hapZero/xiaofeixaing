import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Vinext currently applies the server-action request guard to App Router
      // multipart route handlers as well. Creative source images regularly
      // exceed the 1 MB framework default, so keep an explicit bounded limit.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
