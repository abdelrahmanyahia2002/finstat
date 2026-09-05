/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared package ships TypeScript sources compiled to CommonJS; letting
  // Next transpile it keeps one source of truth for the taxonomy and the
  // statement engine across the API and the browser.
  transpilePackages: ['@finstat/shared'],
};

export default nextConfig;
