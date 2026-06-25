/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Transformers.js (via onnxruntime) tries to load Node-only native bindings
    // when bundled for SSR. We only need the web runtime, so ignore those imports.
    config.resolve.alias = {
      ...config.resolve.alias,
      'onnxruntime-node': 'onnxruntime-web',
    };
    return config;
  },
};

module.exports = nextConfig;
