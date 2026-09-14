import type { NextConfig } from "next";

// `npm run dev` runs the app against a live Django server instead of exporting
// it, proxying the endpoints that need a real backend. Static export cannot
// express rewrites, so the two modes are mutually exclusive by design.
const isDevProxy = process.env.BRIEFS_DEV_PROXY === "1";
const django = process.env.BRIEFS_DJANGO_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // A static export, served by Django from briefs/static/briefs/.
  ...(isDevProxy ? {} : { output: "export" as const }),

  // The app lives under /briefs/ on the marking site. Per the Next.js docs,
  // basePath only rewrites next/link and next/router URLs -- neither of which
  // this app uses -- so its whole job here is to prefix the _next/ asset URLs
  // baked into the exported HTML. The `./builder` style links are resolved by
  // the browser against the current URL instead.
  basePath: "/briefs",

  // Load-bearing, not a preference. From /briefs/builder, `./reviews` resolves
  // to /briefs/reviews. With trailing slashes on, /briefs/builder/ would make
  // the same href resolve to /briefs/builder/reviews. (The index is the one
  // exception and is served with its slash; /briefs redirects to /briefs/.)
  trailingSlash: false,

  // No Next.js image optimisation server behind a static export.
  images: {
    unoptimized: true,
  },

  // In dev the trailing-slash redirect would fight both halves of this setup:
  // it rewrites `/briefs/` to `/briefs` (breaking the relative `./builder`
  // links) and strips the slash off the API paths before the proxy sees them.
  // Django serves `/briefs/` directly, so production never does this.
  ...(isDevProxy ? { skipTrailingSlashRedirect: true } : {}),

  ...(isDevProxy
    ? {
        // `basePath: false` keeps these at the domain root: the API and the
        // marking-site login live outside /briefs/. Proxying login through the
        // same origin is what lets Django's session cookie reach the dev server.
        async rewrites() {
          return [
            // The trailing slash is re-added deliberately: `:path*` drops the
            // empty last segment, and every Django endpoint here needs it.
            { source: "/api/:path*", destination: `${django}/api/:path*/`, basePath: false as const },
            { source: "/login", destination: `${django}/login`, basePath: false as const },
            { source: "/logout", destination: `${django}/logout`, basePath: false as const },
            { source: "/debug/:path*", destination: `${django}/debug/:path*`, basePath: false as const },
          ];
        },
      }
    : {}),
};

export default nextConfig;
