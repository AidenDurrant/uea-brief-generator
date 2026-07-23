import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "export",

  // IF you are deploying to a project repo (e.g., https://username.github.io/my-repo-name)
  // uncomment the next line and add your exact repo name:
  // basePath: '/my-repo-name',

  // Disable image optimization because GitHub Pages doesn't have a Node.js server
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
