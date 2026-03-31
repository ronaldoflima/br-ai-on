import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    AGENTS_DIR: process.env.AGENTS_DIR || "../agents",
    METRICS_DIR: process.env.METRICS_DIR || "../metrics",
    LOGS_DIR: process.env.LOGS_DIR || "../logs",
  },
};

export default nextConfig;