/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // v20.5: Production optimizations
  // - swcMinify: faster + smaller bundles via SWC instead of Terser (Next 13+ default but explicit for safety)
  // - compress: gzip responses at the edge (Vercel does this anyway, but harmless)
  // - poweredByHeader: removes the "X-Powered-By: Next.js" header (tiny network saving)
  // - productionBrowserSourceMaps: false keeps the production bundle small (default but explicit)
  swcMinify: true,
  compress: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
};

module.exports = nextConfig;
