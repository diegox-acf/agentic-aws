import type { NextConfig } from "next";

// Static export: `next build` writes plain files to out/, served from S3 through CloudFront.
// There is no server, so nothing that needs one (route handlers, rewrites, headers, proxy,
// server actions, cacheComponents, default image optimization) can be used.
const nextConfig: NextConfig = {
  output: "export",
  // /stats/ -> out/stats/index.html. CloudFront's viewer-request function appends index.html,
  // because the S3 REST endpoint (unlike the website endpoint) has no directory indexes.
  trailingSlash: true,
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
