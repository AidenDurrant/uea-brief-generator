import type { NextConfig } from "next";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const isGitHubPagesBuild = process.env.GITHUB_ACTIONS === "true";
const isUserOrOrganisationSite = repositoryName.endsWith(".github.io");

// Project Pages sites are served from /repository-name. User/organisation Pages
// sites and local development are served from the domain root.
const basePath =
  isGitHubPagesBuild && repositoryName && !isUserOrOrganisationSite
    ? `/${repositoryName}`
    : "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,

  // GitHub Pages has no Next.js image optimisation server.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
